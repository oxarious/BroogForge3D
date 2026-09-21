import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGlb } from '../server/assets.js';
import { createEngines, validateOptions } from '../server/engines.js';
import path from 'node:path';

function glb(json) {
  const text = Buffer.from(JSON.stringify(json));
  const length = Math.ceil(text.length / 4) * 4;
  const data = Buffer.alloc(20 + length, 32);
  data.write('glTF'); data.writeUInt32LE(2,4); data.writeUInt32LE(data.length,8);
  data.writeUInt32LE(length,12); data.writeUInt32LE(0x4E4F534A,16); text.copy(data,20);
  return data;
}
test('mesh validation rejects empty, truncated and external-resource GLBs', () => {
  assert.throws(() => validateGlb(undefined));
  const valid = glb({ asset: {version:'2.0'}, meshes:[{primitives:[]}] });
  assert.ok(validateGlb(valid));
  assert.throws(() => validateGlb(valid.subarray(0, valid.length - 1)));
  for (const uri of ['https://example.com/a.png','../../secret','data:image/png;base64,abcd']) {
    assert.throws(() => validateGlb(glb({ asset:{version:'2.0'}, meshes:[{}], images:[{uri}] })), /resources/);
  }
  assert.throws(() => validateGlb(glb({asset:{version:'2.0'}})), /mesh/);
});
test('registry separates mesh operations from image generation', () => {
  const engines = createEngines(path.resolve('.'));
  assert.equal(engines.get('gltf-transform').kind, 'mesh');
  assert.equal(engines.get('gltf-transform').status().installed, true);
  assert.throws(() => validateOptions({engineId:'gltf-transform'}, engines), /GLB/);
  assert.equal(engines.list().length,4);
});
