import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const directory = path.resolve('exports/broog-local-trials-2026-09-21');
const jobs = await (await fetch('http://127.0.0.1:8790/api/jobs')).json();
const variants = [
  ['trellis-seed42', '236be11a-d718-4070-b6e1-a238f309daa0'],
  ['trellis-seed42-balanced', '98c29e9d-b661-43c2-9ac3-3507f640966e'],
  ['trellis-seed7', '3b940ba5-653d-4a91-a299-bf925acfa188'],
  ['pixal-seed42-geometry', '0c82ad2b-8253-423d-bacd-dc8a8e6192ab'],
];
for (const [, id] of variants) {
  if (jobs.find(job => job.id === id)?.status !== 'complete') throw new Error(`Job not complete: ${id}`);
}
await fs.mkdir(directory, {recursive: true});
const reference = await fs.readFile('C:/OG-Business/Clinic-pro/broog-character/broog-approved-blue-eyes.png');
await fs.writeFile(path.join(directory, 'approved-reference.png'), reference);
const manifest = {
  createdAt: new Date().toISOString(),
  status: 'Experimental static meshes. Not approved for production or animation.',
  referenceSha256: createHash('sha256').update(reference).digest('hex'),
  inference: 'Local NVIDIA GeForce RTX 5070 Laptop GPU. No cloud inference.',
  variants: [],
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setAllowNetwork(false);
for (const [name, id] of variants) {
  const job = jobs.find(job => job.id === id);
  const data = await fs.readFile(path.resolve('data/jobs', id, 'model.glb'));
  const document = await io.readBinary(data);
  const root = document.getRoot();
  const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((count, primitive) => count + (primitive.getIndices()?.getCount() || primitive.getAttribute('POSITION').getCount()) / 3, 0), 0);
  await fs.writeFile(path.join(directory, `${name}.glb`), data);
  const views = path.join(directory, name);
  await fs.mkdir(views, {recursive: true});
  for (const view of ['front', 'quarter', 'side', 'back', 'face', 'dashboard']) {
    const source = path.resolve('artifacts', `broog-${id}`, `${view}.png`);
    try { await fs.copyFile(source, path.join(views, `${view}.png`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  manifest.variants.push({ name, id, engine: job.engineId, seed: job.seed, resolution: job.resolution,
    sourceJobId: job.sourceJobId, profile: job.profile, bytes: data.length, triangles,
    textures: root.listTextures().length, skins: root.listSkins().length, animations: root.listAnimations().length,
    sha256: createHash('sha256').update(data).digest('hex'), startedAt: job.startedAt, finishedAt: job.finishedAt });
}
await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
