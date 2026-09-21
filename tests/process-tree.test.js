import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobQueue } from '../server/queue.js';

test('Windows rig cancellation terminates its owned child process tree', {skip:process.platform !== 'win32', timeout:15000}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'broog-tree-'));
  const program = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log('CHILD_PID='+child.pid); setInterval(()=>{},1000);`;
  const engine = { status:() => ({installed:true}), command:() => ({executable:process.execPath,args:['-e',program]}) };
  const queue = new JobQueue({directory,engines:{get:() => engine}});
  t.after(async () => { await queue.stop(); fs.rmSync(directory,{recursive:true,force:true}); });
  const job = queue.add({engineId:'unirig',kind:'mesh'},Buffer.from('fixture'));
  let childPid;
  for (let i=0;i<100;i++) {
    const line = queue.jobs[0].log.find(line => line.startsWith('CHILD_PID='));
    if (line) { childPid=Number(line.slice(10)); break; }
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(childPid);
  const rootPid = queue.active.child.pid;
  const done = queue.active.done;
  queue.cancel(job.id);
  await done;
  for (const pid of [rootPid,childPid]) {
    let alive = true;
    for(let i=0;i<50;i++) {
      try { process.kill(pid,0); } catch(e) { if(e.code==='ESRCH') {alive=false;break;} throw e; }
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(alive,false,`Process ${pid} survived cancellation`);
  }
  assert.equal(queue.jobs[0].status,'cancelled');
});
