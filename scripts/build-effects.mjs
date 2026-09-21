import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'public/effects');
await fs.mkdir(path.join(output,'dist'),{recursive:true});
await build({entryPoints:[path.join(root,'effects/main.js')],outfile:path.join(output,'dist/main.js'),bundle:true,format:'esm',target:['es2022'],minify:true,legalComments:'linked',metafile:true}).then(async result=>{
  await fs.writeFile(path.join(root,'data/effects-build.json'),JSON.stringify(result.metafile,null,2));
});
await fs.mkdir(path.join(output,'licenses'),{recursive:true});
for(const [pkg,file] of [['three','LICENSE'],['motion','LICENSE.md'],['animejs','LICENSE.md'],['lucide','LICENSE']]){
  await fs.copyFile(path.join(root,'node_modules',pkg,file),path.join(output,'licenses',pkg+'.txt'));
}
console.log('Effects Studio built: /effects/');
