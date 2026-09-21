import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, simplify, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [executable, models, input, output, seed] = process.argv.slice(2);
if (!output || !/^\d+$/.test(seed || '')) throw new Error('Invalid Pixal worker arguments.');
const dump = path.join(path.dirname(output), 'cleaned-geometry.bin');
const child = spawn(executable, [input, output, '--model','pixal3d','--models',models,
  '--res','512','--seed',seed,'--gpu','0','--require-gpu','--threads','8','--dump-post',dump],
  {cwd:path.dirname(executable),stdio:'inherit',windowsHide:true,shell:false});
const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); });
if (code !== 0) throw new Error(`Pixal inference failed (exit ${code}).`);
console.log('BROOG_EVENT {"stage":"Preparing cleaned mesh","progress":85}');
const data = fs.readFileSync(dump);
if (data.length < 16) throw new Error('Cleaned mesh dump is truncated.');
const vertices = data.readInt32LE(0), faces = data.readInt32LE(4), pbr = data.readInt32LE(8);
if (vertices <= 0 || faces <= 0 || pbr !== 0 || data.length !== 16 + vertices * 12 + faces * 12) throw new Error('Unexpected cleaned geometry layout.');
const positions = new Float32Array(Uint8Array.from(data.subarray(16,16+vertices*12)).buffer);
const indices = new Uint32Array(Uint8Array.from(data.subarray(16+vertices*12)).buffer);
if (positions.some(n => !Number.isFinite(n)) || indices.some(n => n >= vertices)) throw new Error('Cleaned mesh contains invalid geometry.');
const document = new Document();
const buffer = document.createBuffer();
const primitive = document.createPrimitive()
  .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
  .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
  .setMaterial(document.createMaterial('Untextured geometry').setBaseColorFactor([0.55,0.62,0.58,1]).setMetallicFactor(0).setRoughnessFactor(0.8));
document.createScene('Pixal3D').addChild(document.createNode('Generated mesh').setMesh(document.createMesh().addPrimitive(primitive)));
await MeshoptSimplifier.ready;
console.log('BROOG_EVENT {"stage":"Simplifying cleaned mesh","progress":90}');
await document.transform(dedup(), weld(), simplify({simplifier:MeshoptSimplifier,ratio:Math.min(1,150000/faces),error:0.003,lockBorder:true}), normals(), weld(), prune());
console.log('BROOG_EVENT {"stage":"Exporting asset","progress":97}');
await new NodeIO().write(output, document);
const triangles = document.getRoot().listMeshes().reduce((sum,m) => sum + m.listPrimitives().reduce((n,p) => n+(p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount())/3,0),0);
console.log(`BROOG_EVENT ${JSON.stringify({stage:'Ready',progress:100,geometry:{triangles,bytes:fs.statSync(output).size}})}`);
