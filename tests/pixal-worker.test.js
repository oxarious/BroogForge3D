import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';

test('Pixal cleaned-dump adapter exports a shaded GLB without modifying upstream', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'broog-pixal-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const fakeCLI = path.join(directory,'fake-cli.cjs');
  // A synthetic tetrahedron tests the dump contract, not neural inference quality.
  fs.writeFileSync(fakeCLI, `const fs=require('node:fs'); const dest=process.argv[process.argv.indexOf('--dump-post')+1]; const b=Buffer.alloc(112); [4,4,0,512].forEach((n,i)=>b.writeInt32LE(n,i*4)); [0,0,0,1,0,0,0,1,0,0,0,1].forEach((n,i)=>b.writeFloatLE(n,16+i*4)); [0,2,1,0,1,3,0,3,2,1,2,3].forEach((n,i)=>b.writeInt32LE(n,64+i*4)); fs.writeFileSync(dest,b);`);
  const output = path.join(directory,'model.glb');
  const {stdout} = await promisify(execFile)(process.execPath,['workers/pixal.mjs',process.execPath,directory,fakeCLI,output,'42'],{windowsHide:true});
  assert.match(stdout, /Simplifying cleaned mesh/);
  assert.match(stdout, /"triangles":4/);
  const doc = await new NodeIO().read(output);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  assert.ok(prim.getAttribute('NORMAL'));
  assert.equal(prim.getMaterial().getMetallicFactor(),0);
  assert.equal(doc.getRoot().listTextures().length,0);
});
