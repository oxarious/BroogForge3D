import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { TextureService, texturePayload, normalizeTextureImage } from '../server/textures.js';
const base = { prompt: 'woodland elf', seed: 42, reference: 'reference', depth: 'depth', models: ['control_v11f1p_sd15_depth [abc]', 'ip-adapter-plus_sd15 [def]'] };
test('projection combines depth and reference without FaceID', () => {
  const payload = texturePayload(base);
  assert.equal(payload.width, 512);
  assert.equal(payload.batch_size, 1);
  assert.deepEqual(payload.alwayson_scripts.ControlNet.args.map(unit => unit.image), ['depth', 'reference']);
  assert.equal(payload.alwayson_scripts.ControlNet.args[1].module, 'CLIP-ViT-H (IPAdapter)');
});
test('invalid projection parameters rejected', () => {
  for (const update of [{ prompt: '' }, { prompt: 'x'.repeat(2001) }, { seed: -1 }, { seed: 1.2 }, { models: [] }, { referenceWeight: NaN }, { referenceWeight: 1.1 }, { negativePrompt: 'x'.repeat(2001) }]) {
    assert.throws(() => texturePayload({ ...base, ...update }));
  }
});
test('images are bounded and normalized', async () => {
  const buffer = await sharp({ create: { width: 64, height: 128, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const result = await normalizeTextureImage(buffer);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  await assert.rejects(normalizeTextureImage(undefined));
  await assert.rejects(normalizeTextureImage(Buffer.alloc(16 * 1024 * 1024)));
  await assert.rejects(normalizeTextureImage(Buffer.from('<svg/>')));
});
test('missing setup and unfinished assets cannot launch or export', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broog-texture-'));
  try {
    const service = new TextureService(root, { active: null, jobs: [] });
    assert.equal(service.snapshot().phase, 'stopped');
    await assert.rejects(service.start(), /setup/);
    await assert.rejects(service.handoff('../bad'), /completed/);
    await assert.rejects(service.generate({}, {}), /ready/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('3D queue prevents texture backend admission', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broog-texture-'));
  try {
    const queue = { active: null, jobs: [{ status: 'queued' }] };
    const service = new TextureService(root, queue); service.setup = () => true;
    await assert.rejects(service.start(), /3D queue/);
    queue.jobs = []; queue.active = { id: 'active' };
    await assert.rejects(service.start(), /3D queue/);
    queue.active = null; service.busy = true;
    await assert.rejects(service.start(), /previous projection/);
    assert.equal(service.child, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('inference and persistence failures are contained', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broog-texture-'));
  try {
    const service = new TextureService(root, { active: null, jobs: [] });
    service.request = async () => { throw new Error('Inference failed'); };
    service.save = () => { throw new Error('Disk full'); };
    service.busy = true;
    const job = {};
    await service.run(job, {});
    assert.equal(service.busy, false);
    assert.equal(job.status, 'failed');
    assert.equal(service.phase, 'failed');
    assert.match(job.error, /Disk full/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
