import fs from 'node:fs/promises';
const base = process.env.BROOGFORGE_URL || 'http://127.0.0.1:8790';
const data = new FormData();
data.append('engineId','pixal3d'); data.append('resolution','512'); data.append('seed','42');
data.append('image',new Blob([await fs.readFile('vendor/trellis.cpp/assets/showcase/chest/chest.png')],{type:'image/png'}),'chest.png');
const response = await fetch(`${base}/api/jobs`,{method:'POST',body:data});
const submitted = await response.json();
if(!response.ok) throw new Error(submitted.error);
console.log(`Pixal job: ${submitted.id}`);
let last = '';
let peakSampledMb = 0;
let job;
try {
  for(let i=0;i<370;i++) {
    job = (await (await fetch(`${base}/api/jobs`)).json()).find(j=>j.id===submitted.id);
    const system = await (await fetch(`${base}/api/system`)).json();
    peakSampledMb = Math.max(peakSampledMb,system.usedMb || 0);
    const stage = `${job.status}: ${job.stage}`;
    if(stage!==last) {console.log(stage);last=stage;}
    if(!['running','queued'].includes(job.status)) break;
    await new Promise(r=>setTimeout(r,5000));
  }
} finally {
  if(!job || ['running','queued'].includes(job.status)) await fetch(`${base}/api/jobs/${submitted.id}/cancel`,{method:'POST'});
  await fs.writeFile('artifacts/pixal-report.json',JSON.stringify({at:new Date().toISOString(),peakSampledMb,job},null,2));
}
console.log(JSON.stringify({id:job.id,status:job.status,bytes:job.bytes,error:job.error,peakSampledMb},null,2));
if(job.status!=='complete') process.exitCode=1;
