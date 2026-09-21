import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.BROOGFORGE_URL || 'http://127.0.0.1:8790';
const report = { startedAt: new Date().toISOString(), mode: '2D projection only', peakUsedMb: 0 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
try {
  await api('/api/textures/start', { method: 'POST' });
  let state;
  const startup = Date.now();
  while (Date.now() - startup < 240000) {
    state = await api('/api/textures');
    if (state.phase === 'ready') break;
    if (state.phase === 'failed') throw new Error(state.error);
    await sleep(3000);
  }
  assert.equal(state.phase, 'ready');
  report.models = state.models;
  const body = new FormData();
  body.set('reference', new Blob([await fs.readFile('C:/OG-Business/Clinic-pro/broog-character/broog-approved-blue-eyes.png')], { type: 'image/png' }), 'reference.png');
  body.set('depth', new Blob([await fs.readFile('exports/broog-depth.png')], { type: 'image/png' }), 'depth.png');
  body.set('seed', '42');
  body.set('prompt', 'Friendly male woodland elf wizard, bright blue eyes, chestnut hair and small chin beard, oversized bent teal wizard hat with leaf, plum scarf, moss green coat, brown leather boots, wooden staff, painted fantasy character, full body');
  const job = await api('/api/textures/generate', { method: 'POST', body });
  report.jobId = job.id;
  console.log(`Generating ${job.id}`);
  const started = Date.now();
  while (Date.now() - started < 660000) {
    state = await api('/api/textures');
    const gpu = await api('/api/system'); report.peakUsedMb = Math.max(report.peakUsedMb, gpu.usedMb || 0);
    const current = state.jobs.find(item => item.id === job.id);
    if (current.status !== 'running') {
      report.result = current; report.seconds = (Date.now() - started) / 1000;
      await fs.writeFile('artifacts/texture-inference.log', state.log);
      assert.equal(current.status, 'complete', current.error);
      const image = await fetch(`${base}${current.imageUrl}`);
      assert.equal(image.status, 200);
      await fs.writeFile('artifacts/broog-projection.png', Buffer.from(await image.arrayBuffer()));
      break;
    }
    await sleep(5000);
  }
  assert.ok(report.result, 'Inference did not finish in time');
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await api('/api/textures/stop', { method: 'POST' });
  report.finishedAt = new Date().toISOString();
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/texture-report.json', JSON.stringify(report, null, 2));
  console.log(report);
}
