import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, profile = 'balanced'] = process.argv.slice(2);
if (!input || !output || !['balanced', 'compact', 'lossless'].includes(profile)) throw new Error('Invalid optimization arguments.');
const event = (stage, progress, extra = {}) => console.log(`BROOG_EVENT ${JSON.stringify({ stage, progress, ...extra })}`);
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).setAllowNetwork(false);
// Refuse external resources before the loader can read local files or network URLs.
const data = fs.readFileSync(input);
const { validateGlb } = await import('../server/assets.js');
validateGlb(data);
event('Reading asset', 5);
const document = await io.readBinary(data);
const stats = () => ({ triangles: document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getMode() === 4 ? Math.floor((p.getIndices()?.getCount() || p.getAttribute('POSITION')?.getCount() || 0) / 3) : 0), 0), 0), textures: document.getRoot().listTextures().length });
const before = { bytes: data.length, ...stats() };
event('Cleaning mesh', 20);
await document.transform(dedup(), prune(), weld());
if (profile !== 'lossless') {
  event('Reducing geometry', 40);
  const ratio = Math.min(profile === 'compact' ? 0.35 : 0.65, (profile === 'compact' ? 60000 : 150000) / Math.max(1, before.triangles));
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001, lockBorder: true }));
  event('Compressing textures', 65);
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: profile === 'compact' ? [1024, 1024] : [2048, 2048], quality: profile === 'compact' ? 78 : 88 }));
}
event('Writing GLB', 90);
const result = await io.writeBinary(document);
fs.writeFileSync(output, result);
event('Ready', 100, { metrics: { before, after: { bytes: result.length, ...stats() }, profile } });
