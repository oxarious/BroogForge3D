import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaults, normalizePreset } from '../effects/presets.js';

test('effect presets validate and bound saved settings',()=>{
  assert.deepEqual(normalizePreset(null),defaults);
  assert.deepEqual(normalizePreset({finish:'nope',quality:'unsafe',speed:Infinity,still:'true'}),defaults);
  assert.deepEqual(normalizePreset({finish:'ion',intensity:-20,speed:8,quality:'eco',still:true}),{finish:'ion',intensity:0,speed:1,quality:'eco',still:true});
  assert.deepEqual(normalizePreset(JSON.parse(JSON.stringify(defaults))),defaults);
});
test('showcase bundles all three engines and local visual assets',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const build=JSON.parse(fs.readFileSync(path.join(root,'data/effects-build.json'),'utf8'));
  for(const library of ['three','animejs','framer-motion'])assert.ok(Object.keys(build.inputs).some(p=>p.includes(library)),`${library} missing from bundle`);
  const bundle=fs.statSync(path.join(root,'public/effects/dist/main.js'));
  assert.ok(bundle.size<900_000,'Keep the initial script under 900 KB uncompressed');
  for(const id of ['silver','carbon','ion'])assert.ok(fs.statSync(path.join(root,`public/effects/assets/${id}.webp`)).size>1000);
  const html=fs.readFileSync(path.join(root,'public/effects/index.html'),'utf8');
  for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))assert.ok(fs.existsSync(path.join(root,'public/effects',match[1])),`Missing asset ${match[1]}`);
});
