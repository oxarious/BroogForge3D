import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:8790';
const output = 'C:/OG-Business/Clinic-pro/broog-character/web-ready-v2';
const reference = 'artifacts/broog-projection.png';
await fs.mkdir(output, { recursive: true });
const textureState = await (await fetch(`${base}/api/textures`)).json();
if (textureState.busy) throw new Error('Texture generation is active.');
await fetch(`${base}/api/textures/stop`, { method: 'POST' });
const body = new FormData();
body.set('engineId', 'trellis-q4'); body.set('resolution', '512'); body.set('seed', '42');
body.set('image', new Blob([await fs.readFile(reference)], { type: 'image/png' }), 'broog-refined-reference.png');
const response = await fetch(`${base}/api/jobs`, { method: 'POST', body });
const submitted = await response.json();
if (!response.ok) throw new Error(submitted.error);
console.log(`Broog refined candidate: ${submitted.id}`);
let job, last;
try {
  for (let i = 0; i < 240; i++) {
    job = (await (await fetch(`${base}/api/jobs`)).json()).find(item => item.id === submitted.id);
    if (job.stage !== last) { console.log(job.stage); last = job.stage; }
    if (!['queued', 'running'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (job.status !== 'complete') throw new Error(job.error || 'Generation did not finish');
  await fs.writeFile(`${output}/candidate-generation.json`, JSON.stringify(job, null, 2));
  const mesh = await fetch(`${base}${job.outputUrl}`);
  await fs.writeFile(`${output}/broog-refined-candidate.glb`, Buffer.from(await mesh.arrayBuffer()));
  console.log(`${output}/broog-refined-candidate.glb`);
} finally {
  if (!job || ['running', 'queued'].includes(job.status)) await fetch(`${base}/api/jobs/${submitted.id}/cancel`, { method: 'POST' });
}
