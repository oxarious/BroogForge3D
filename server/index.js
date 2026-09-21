import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEngines, validateOptions } from './engines.js';
import { JobQueue } from './queue.js';
import { validateGlb } from './assets.js';
import { TextureService } from './textures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'data/app.lock');
fs.mkdirSync(path.dirname(lockFile), { recursive: true });
// Own the shared queue before reading or rewriting it, even when another port is free.
function acquireLock() {
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    let alive = true;
    try { process.kill(existing.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') alive = false; else throw cause; }
    if (alive) throw new Error('BroogForge is already running. Use Start BroogForge.ps1 to open it.');
    fs.unlinkSync(lockFile); acquireLock();
  }
}
acquireLock();
process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch {} });
const engines = createEngines(root);
const queue = new JobQueue({ directory: path.join(root, 'data/jobs'), engines });
const textures = new TextureService(root, queue);
const app = express();
app.disable('x-powered-by');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 4 } });
const meshUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 4 } });
let port;
let gpu = { gpu: 'GPU information unavailable', vramMb: 0 };
let gpuPolling = false;
let lastGpuSample = 0;
async function sampleGpu() {
  if (gpuPolling || Date.now() - lastGpuSample < 5000) return;
  gpuPolling = true;
  lastGpuSample = Date.now();
  try {
    const { stdout } = await promisify(execFile)('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 4000 });
    const [usedMb, utilization, temperature] = stdout.trim().split('\n')[0].split(',').map(Number);
    gpu = { ...gpu, usedMb, utilization, temperature, sampledAt: new Date().toISOString() };
  } catch { gpu = { ...gpu, usedMb: null, utilization: null, temperature: null }; }
  finally { gpuPolling = false; }
}
void sampleGpu();
try {
  const { stdout } = await promisify(execFile)('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 });
  const [name, memory] = stdout.trim().split('\n')[0].split(',');
  gpu = { ...gpu, gpu: name.trim(), vramMb: Number(memory) };
} catch {}

app.use((req, res, next) => {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(req.headers.host)) return res.status(403).json({ error: 'Local access only.' });
  const origin = req.headers.origin;
  if (origin && !allowed.some(host => origin === `http://${host}`)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
  next();
});
app.get('/api/system', (req,res) => {
  void sampleGpu();
  res.json({ ...gpu, busy: Boolean(queue.active) || textures.busy, error: queue.storageError?.message ?? null });
});
app.get('/api/engines', (req,res) => res.json(engines.list()));
app.get('/api/jobs', (req,res) => { res.setHeader('Cache-Control','no-store'); res.json(queue.list()); });
const textureUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 2, fields: 4 } });
app.get('/api/textures', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(textures.snapshot()); });
app.post('/api/textures/start', async (req, res) => { try { await textures.start(); res.json(textures.snapshot()); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post('/api/textures/stop', async (req, res) => { try { await textures.stop(); res.json(textures.snapshot()); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post('/api/textures/editor', (req, res) => { try { textures.openEditor(); res.json({ ok: true }); } catch (error) { res.status(400).json({ error: error.message }); } });
app.post('/api/textures/handoff', express.json({ limit: '2kb' }), async (req, res) => { try { res.json(await textures.handoff(req.body.sourceJobId)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.post('/api/textures/generate', textureUpload.fields([{ name: 'reference', maxCount: 1 }, { name: 'depth', maxCount: 1 }]), async (req, res) => {
  try { res.status(201).json(await textures.generate(req.body, req.files)); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/textures/jobs/:id/image', (req, res) => {
  const job = textures.jobs.find(job => job.id === req.params.id && job.status === 'complete');
  if (!job) return res.sendStatus(404);
  if (req.query.download) res.attachment(`projection-${job.id}.png`);
  res.sendFile(path.join(textures.directory, job.id, 'projection.png'));
});
app.post('/api/process', meshUpload.single('model'), (req,res) => {
  try {
    if (textures.running) throw new Error('Stop the texture backend before processing 3D assets.');
    const engine = engines.get(req.body.engineId);
    if (!engine || engine.kind !== 'mesh') throw new Error('Choose a mesh processing engine.');
    const health = engine.status();
    if (!health.installed) throw new Error(health.reason);
    const profile = req.body.profile || 'balanced';
    if (!['balanced','compact','lossless'].includes(profile)) throw new Error('Unknown optimization profile.');
    let data = req.file?.buffer;
    const sourceJobId = req.body.sourceJobId;
    if (data && sourceJobId) throw new Error('Choose either a library asset or an uploaded GLB.');
    if (sourceJobId) {
      const source = queue.jobs.find(job => job.id === sourceJobId && job.status === 'complete');
      if (!source) throw new Error('Source asset is unavailable.');
      if (fs.statSync(source.outputPath).size > 64 * 1024 * 1024) throw new Error('GLB exceeds the 64 MB processing limit.');
      data = fs.readFileSync(source.outputPath);
    }
    validateGlb(data);
    res.status(201).json(queue.add({ engineId: engine.id, kind: 'mesh', profile, seed: 42, sourceJobId: sourceJobId || null }, data));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/jobs', upload.single('image'), async (req,res) => {
  try {
    if (textures.running) throw new Error('Stop the texture backend before generating 3D assets.');
    const options = validateOptions(req.body, engines);
    if (!req.file) throw new Error('Choose a PNG, JPEG or WebP reference image.');
    const source = sharp(req.file.buffer, { limitInputPixels: 25_000_000, animated: false });
    const meta = await source.metadata();
    if (!['png','jpeg','webp'].includes(meta.format)) throw new Error('Only PNG, JPEG and WebP images are supported.');
    const png = await source.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    res.status(201).json(queue.add(options,png));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/jobs/:id/cancel', (req,res) => res.status(queue.cancel(req.params.id) ? 200 : 404).json({ ok: true }));
app.delete('/api/jobs/:id', (req,res) => {
  try { res.status(queue.remove(req.params.id) ? 200 : 404).json({ ok: true }); }
  catch(error) { res.status(409).json({ error: error.message }); }
});
app.get('/api/jobs/:id/:asset', (req,res) => {
  const job = queue.jobs.find(j => j.id === req.params.id);
  if (!job) return res.sendStatus(404);
  if (req.params.asset === 'log') {
    res.attachment(`broogforge-${job.id.slice(0,8)}.log`);
    return res.sendFile(path.join(path.dirname(job.inputPath), 'generation.log'));
  }
  if (req.params.asset === 'input') return res.sendFile(job.inputPath);
  if (req.params.asset === 'model' && job.status === 'complete') {
    res.type('model/gltf-binary');
    if (req.query.download) res.attachment(`broogforge-${job.id.slice(0,8)}.glb`);
    return res.sendFile(job.outputPath);
  }
  res.sendStatus(404);
});
app.get('/vendor/model-viewer.min.js', (req,res) => res.sendFile(path.join(root,'vendor/trellis.cpp/app/public/vendor/model-viewer.min.js')));
app.get('/vendor/lucide.js', (req,res) => res.sendFile(path.join(root,'node_modules/lucide/dist/umd/lucide.js')));
app.use(express.static(path.join(root,'public')));
app.use((error,req,res,next) => { console.error(error.message); res.status(400).json({ error: error.message }); });

let server;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await textures.stop(); } catch (error) { console.error(error.message); shuttingDown = false; return; }
  const result = await queue.stop();
  if (!result.stopped) {
    console.error('Shutdown postponed: engine termination has not been confirmed.');
    shuttingDown = false;
    return;
  }
  server.close(); server.closeIdleConnections();
  try { fs.unlinkSync(path.join(root,'data/server.json')); } catch {}
  setTimeout(() => process.exit(0), 500).unref();
}
app.post('/api/shutdown', (req,res) => { res.json({ ok: true }); setTimeout(shutdown,100); });
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

async function listen(candidate) {
  port = candidate;
  return new Promise((resolve,reject) => {
    const listener = app.listen(candidate, '127.0.0.1', () => resolve(listener));
    listener.once('error',reject);
  });
}
for (let candidate = Number(process.env.PORT || 8790); candidate < Number(process.env.PORT || 8790)+20; candidate++) {
  try { server = await listen(candidate); break; } catch(error) { if (error.code !== 'EADDRINUSE') throw error; }
}
if (!server) throw new Error('No free local port found.');
const url = `http://127.0.0.1:${port}`;
fs.writeFileSync(path.join(root,'data/server.json'), JSON.stringify({ pid: process.pid, url }));
console.log(`BroogForge: ${url}`);
