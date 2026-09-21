import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

export function texturePayload({ prompt, seed, reference, depth, models, referenceWeight = 0.7, negativePrompt = '' }) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('Enter a prompt of 1-2000 characters.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('Invalid seed.');
  if (!Number.isFinite(referenceWeight) || referenceWeight < 0 || referenceWeight > 1) throw new Error('Reference weight must be between 0 and 1.');
  if (typeof negativePrompt !== 'string' || negativePrompt.length > 2000) throw new Error('Negative prompt exceeds 2000 characters.');
  const find = prefix => models.find(name => name.startsWith(prefix));
  const depthModel = find('control_v11f1p_sd15_depth');
  const adapter = find('ip-adapter-plus_sd15');
  if (!depthModel || !adapter) throw new Error('Depth and IP-Adapter weights are not registered in Forge.');
  return { prompt, negative_prompt: ['text, watermark, blurry, distorted, duplicate face', negativePrompt].filter(Boolean).join(', '), seed,
    steps: 20, sampler_name: 'Euler', cfg_scale: 6, width: 512, height: 512, batch_size: 1, n_iter: 1,
    alwayson_scripts: { ControlNet: { args: [
      { enabled: true, module: 'None', model: depthModel, image: depth, weight: 1, resize_mode: 'Just Resize', guidance_start: 0, guidance_end: 1 },
      { enabled: true, module: 'CLIP-ViT-H (IPAdapter)', model: adapter, image: reference, weight: referenceWeight, resize_mode: 'Crop and Resize', guidance_start: 0, guidance_end: 1 }
    ] } }
  };
}

export async function normalizeTextureImage(buffer) {
  if (!buffer || buffer.length > 15 * 1024 * 1024) throw new Error('Choose an image under 15 MB.');
  const image = sharp(buffer, { limitInputPixels: 25_000_000, animated: false });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Choose PNG, JPEG or WebP.');
  return image.rotate().resize(512, 512, { fit: 'contain', background: '#000000' }).png().toBuffer();
}

export class TextureService {
  constructor(root, queue) {
    this.root = root; this.queue = queue; this.child = null; this.url = null;
    this.phase = 'stopped'; this.error = null; this.busy = false; this.models = [];
    this.directory = path.join(root, 'data/textures');
    this.logPath = path.join(root, 'data/forge.log');
    fs.mkdirSync(this.directory, { recursive: true });
    this.jobs = fs.readdirSync(this.directory).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(this.directory, id, 'job.json')));
        if (job.id !== id) return [];
        if (job.status === 'running') { job.status = 'failed'; job.stage = 'Interrupted'; job.error = 'App restarted before completion.'; this.save(job); }
        return [job];
      } catch { return []; }
    });
  }
  get running() { return Boolean(this.child) || this.phase === 'starting'; }
  setup() {
    return fs.existsSync(path.join(this.root, 'runtime/forge-ready.json')) && fs.existsSync(path.join(this.root, 'runtime/texture-models.json'));
  }
  snapshot() {
    let log = '';
    if (fs.existsSync(this.logPath)) {
      const fd = fs.openSync(this.logPath, 'r');
      try { const size = fs.fstatSync(fd).size; const data = Buffer.alloc(Math.min(size, 12000)); fs.readSync(fd, data, 0, data.length, Math.max(0, size - data.length)); log = data.toString(); } finally { fs.closeSync(fd); }
    }
    return { setupComplete: this.setup(), phase: this.phase, backendRunning: this.running, error: this.error, url: this.url, busy: this.busy,
      models: this.models, log, jobs: [...this.jobs].reverse(), editorAvailable: fs.existsSync(this.editorPath()), editorAutomation: false };
  }
  async request(route, options = {}, timeout = 10000) {
    if (!this.url) throw new Error('Start the texture backend first.');
    const response = await fetch(`${this.url}${route}`, { ...options, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`Forge returned HTTP ${response.status}: ${(await response.text()).slice(0, 700)}`);
    return response.json();
  }
  async start() {
    if (this.running) return;
    if (this.busy) throw new Error('Wait for the previous projection to stop.');
    if (!this.setup()) throw new Error('Texture runtime setup has not completed.');
    if (this.queue.active || this.queue.jobs.some(job => job.status === 'queued')) throw new Error('Wait for the 3D queue to finish.');
    this.phase = 'starting'; this.error = null;
    const launchToken = this.launchToken = Symbol('launch');
    try {
      const port = await new Promise((resolve, reject) => {
        const probe = net.createServer(); probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
      });
      if (this.launchToken !== launchToken) return;
      this.url = `http://127.0.0.1:${port}`;
      const log = fs.openSync(this.logPath, 'w');
      const forge = path.join(this.root, 'vendor/Forge');
      try {
        this.child = spawn(path.join(this.root, 'runtime/forge-env/Scripts/python.exe'),
          ['-u', 'launch.py', '--nowebui', '--skip-prepare-environment', '--skip-install', '--server-name', '127.0.0.1', '--port', String(port), '--disable-extra-extensions', '--attention-pytorch', '--disable-xformers', '--always-offload-from-vram', '--no-half-vae', '--ckpt', path.join(forge, 'models/Stable-diffusion/sd15.safetensors')],
          { cwd: forge, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, GRADIO_ANALYTICS_ENABLED: 'False', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
      } finally { fs.closeSync(log); }
      const child = this.child;
      child.on('error', error => { this.error = error.message; this.phase = 'failed'; this.child = null; });
      child.on('exit', code => { if (this.child === child) { this.child = null; this.phase = 'failed'; this.error = `Forge exited (${code}). See backend log.`; } });
      void this.watchStartup(child);
    } catch (error) { this.phase = 'failed'; this.error = error.message; throw error; }
  }
  async watchStartup(child) {
    for (let attempt = 0; attempt < 180 && this.child === child; attempt++) {
      try {
        const data = await this.request('/controlnet/model_list', {}, 2000);
        const modules = await this.request('/controlnet/module_list', {}, 2000);
        if (this.child !== child) return;
        this.models = data.model_list || [];
        texturePayload({ prompt: 'probe', seed: 42, reference: '', depth: '', models: this.models });
        if (!modules.module_list?.includes('CLIP-ViT-H (IPAdapter)')) throw new Error('IP-Adapter preprocessor unavailable.');
        this.phase = 'ready'; this.error = null; return;
      } catch (error) { if (this.child !== child) return; this.error = error.message; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (this.child === child) { const error = this.error; await this.stop(); this.phase = 'failed'; this.error = `Startup timed out: ${error}`; }
  }
  async stop() {
    this.launchToken = null;
    const child = this.child;
    if (child && child.exitCode === null) {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    }
    this.child = null; this.phase = 'stopped'; this.url = null; this.models = []; this.error = null;
  }
  save(job) {
    const target = path.join(this.directory, job.id, 'job.json');
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(job, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
  async generate(fields, files) {
    if (this.phase !== 'ready' || this.busy || this.queue.active) throw new Error('Texture backend must be ready and idle.');
    this.busy = true;
    try {
      const reference = await normalizeTextureImage(files.reference?.[0]?.buffer);
      const depth = await normalizeTextureImage(files.depth?.[0]?.buffer);
      const payload = texturePayload({ prompt: fields.prompt, seed: Number(fields.seed ?? 42), reference: reference.toString('base64'), depth: depth.toString('base64'), models: this.models, referenceWeight: Number(fields.referenceWeight ?? 0.7), negativePrompt: fields.negativePrompt ?? '' });
      const job = { id: randomUUID(), kind: 'projection', status: 'running', stage: 'Generating reference-guided projection', createdAt: new Date().toISOString(), prompt: fields.prompt, seed: payload.seed, models: [...this.models], steps: payload.steps, width: payload.width, height: payload.height, referenceWeight: payload.alwayson_scripts.ControlNet.args[1].weight, negativePrompt: payload.negative_prompt };
      const directory = path.join(this.directory, job.id); fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'reference.png'), reference); fs.writeFileSync(path.join(directory, 'depth.png'), depth);
      this.save(job); this.jobs.push(job);
      void this.run(job, payload);
      return job;
    } catch (error) { this.busy = false; throw error; }
  }
  async run(job, payload) {
    const child = this.child;
    try {
      const response = await this.request('/sdapi/v1/txt2img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 600000);
      if (!response.images?.[0]) throw new Error('Forge returned no image.');
      const image = await normalizeTextureImage(Buffer.from(response.images[0], 'base64'));
      fs.writeFileSync(path.join(this.directory, job.id, 'projection.png'), image);
      job.status = 'complete'; job.stage = 'Projection ready for review'; job.imageUrl = `/api/textures/jobs/${job.id}/image`;
    } catch (error) {
      job.status = 'failed'; job.stage = 'Failed'; job.error = error.message;
      // A client timeout does not cancel inference on the server.
      if (child && this.child === child) { try { await this.stop(); } catch (stopError) { job.error += `; stop failed: ${stopError.message}`; } }
    }
    finally {
      job.finishedAt = new Date().toISOString();
      try { this.save(job); }
      catch (error) { job.status = 'failed'; delete job.imageUrl; job.error = `Could not save result: ${error.message}`; this.error = job.error; this.phase = 'failed'; }
      this.busy = false;
    }
  }
  editorPath() { return path.join(this.root, 'runtime/stableprojectorz/Stable Projectorz 2.4.5.exe'); }
  openEditor() {
    if (!fs.existsSync(this.editorPath())) throw new Error('StableProjectorz executable not installed.');
    const child = spawn(this.editorPath(), [], { cwd: path.dirname(this.editorPath()), detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', error => { this.error = error.message; }); child.unref();
  }
  async handoff(id) {
    const source = this.queue.jobs.find(job => job.id === id && job.status === 'complete');
    if (!source) throw new Error('Choose a completed library asset.');
    const directory = path.join(this.root, 'exports/texture-handoffs', randomUUID()); fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(source.outputPath, path.join(directory, 'mesh.glb'));
    let reference = source; const seen = new Set();
    while (reference?.kind === 'mesh' && reference.sourceJobId && !seen.has(reference.id)) { seen.add(reference.id); reference = this.queue.jobs.find(job => job.id === reference.sourceJobId); }
    if (reference && reference.kind !== 'mesh' && fs.existsSync(reference.inputPath)) fs.copyFileSync(reference.inputPath, path.join(directory, 'reference.png'));
    const blender = process.env.BROOGFORGE_BLENDER || 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe';
    let importFile = 'mesh.glb';
    if (fs.existsSync(blender)) {
      await promisify(execFile)(blender, ['--background', '--python', path.join(this.root, 'scripts/prepare-texture-mesh.py'), '--', source.outputPath, directory], { windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
      if (!fs.existsSync(path.join(directory, 'mesh-uv.obj'))) throw new Error('Blender did not export a UV-ready mesh.');
      importFile = 'mesh-uv.obj';
    }
    fs.writeFileSync(path.join(directory, 'README.txt'), `BroogForge texture handoff\nSource: ${id}\nForge URL: ${this.url || 'Start the backend in BroogForge first'}\n\nImport ${importFile} into StableProjectorz and connect its WebUI address to Forge.\nUse the included reference when present. ${importFile === 'mesh.glb' ? 'Unwrap UVs in Blender first if the mesh has none.' : 'UVs were preserved or automatically unwrapped. Inspect seams before final export. The original mesh.glb is untouched.'}\nSave the StableProjectorz project before closing it. Exported textures are not automatically imported into BroogForge.\n`);
    return { directory, sourceJobId: id };
  }
}
