import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.BROOGFORGE_URL || 'http://127.0.0.1:8790';
const created = [];
const image = await fs.readFile('vendor/trellis.cpp/assets/showcase/chest/chest.png');
function form({seed='42',resolution='512',bytes=image}={}) {
  const data = new FormData(); data.append('image',new Blob([bytes],{type:'image/png'}),'reference.png');
  data.append('engineId','trellis-q4'); data.append('seed',seed); data.append('resolution',resolution); return data;
}
const results = [];
try {
  assert.equal((await fetch(`${base}/api/jobs`,{method:'POST',headers:{Origin:'https://example.com'},body:form()})).status,403);
  results.push('Cross-origin POST refused');
  for (const options of [{seed:'1 & calc'},{resolution:'1024'},{bytes:Buffer.from('not an image')}]) {
    assert.equal((await fetch(`${base}/api/jobs`,{method:'POST',body:form(options)})).status,400);
  }
  results.push('Invalid seeds, unavailable resolutions and invalid images refused');
  for (let i=0;i<2;i++) {
    const response = await fetch(`${base}/api/jobs`,{method:'POST',body:form()}); assert.equal(response.status,201);
    const job = await response.json(); created.push(job.id); assert.equal(job.inputPath,undefined); assert.equal(job.outputUrl,null);
  }
  const jobs = await (await fetch(`${base}/api/jobs`)).json();
  assert.equal(jobs.find(j=>j.id===created[0]).status,'running');
  assert.equal(jobs.find(j=>j.id===created[1]).status,'queued');
  results.push('Real CLI starts; second job remains queued');
  for (const id of [...created].reverse()) await fetch(`${base}/api/jobs/${id}/cancel`,{method:'POST'});
  for (let i=0;i<50;i++) {
    const current = await (await fetch(`${base}/api/jobs`)).json();
    if (created.every(id=>current.find(j=>j.id===id)?.status==='cancelled')) break;
    if (i===49) throw new Error('Real cancellation timed out');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal((await (await fetch(`${base}/api/system`)).json()).busy,false);
  results.push('Active CLI and queued job cancelled; engine idle');
} finally {
  for (const id of created) {
    await fetch(`${base}/api/jobs/${id}/cancel`,{method:'POST'});
    await fetch(`${base}/api/jobs/${id}`,{method:'DELETE'});
  }
  await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/api-report.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
}
console.log(results.join('\n'));
