import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Document, NodeIO } from '@gltf-transform/core';

test('optimizer preserves a skin and animation and writes a separate GLB', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'broog-optimize-'));
  t.after(() => fs.rmSync(folder, {recursive:true,force:true}));
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', accessor('VEC3',new Float32Array([0,0,0,1,0,0,0,1,0])))
    .setAttribute('JOINTS_0',accessor('VEC4',new Uint16Array(12)))
    .setAttribute('WEIGHTS_0',accessor('VEC4',new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0])));
  const joint = doc.createNode('joint');
  const skin = doc.createSkin('rig').addJoint(joint).setSkeleton(joint);
  const node = doc.createNode('mesh').setMesh(doc.createMesh().addPrimitive(prim)).setSkin(skin);
  doc.createScene().addChild(joint).addChild(node);
  const sampler = doc.createAnimationSampler().setInput(accessor('SCALAR',new Float32Array([0,1]))).setOutput(accessor('VEC3',new Float32Array([0,0,0,0,1,0])));
  doc.createAnimation('wave').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joint).setTargetPath('translation').setSampler(sampler));
  const input = path.join(folder,'source.glb');
  const output = path.join(folder,'result.glb');
  const io = new NodeIO();
  await io.write(input,doc);
  const original = fs.readFileSync(input);
  const {stdout} = await promisify(execFile)(process.execPath,['workers/optimize.mjs',input,output,'lossless'],{windowsHide:true});
  assert.match(stdout, /BROOG_EVENT.*"progress":100/);
  assert.deepEqual(fs.readFileSync(input),original);
  const result = await io.read(output);
  assert.equal(result.getRoot().listSkins().length,1);
  assert.equal(result.getRoot().listAnimations().length,1);
  assert.equal(result.getRoot().listSkins()[0].listJoints()[0].getName(),'joint');
  assert.ok(result.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('WEIGHTS_0'));
});
