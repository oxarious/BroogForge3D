import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { JobQueue, validGlb } from '../server/queue.js';
import { validateOptions } from '../server/engines.js';

const opts = { engineId: 'test', seed: 42, resolution: 512 };
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'broogforge-test-'));
  const children = [];
  const engine = { id: 'test', kind: 'image', resolutions: [512], status: () => ({installed:true}), command: job => ({ executable: 'test', args: [job.outputPath] }) };
  const engines = { get: id => id === 'test' ? engine : undefined };
  const queue = new JobQueue({ directory, engines, ...options, spawnProcess() {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killCalls = [];
    child.kill = signal => { child.killCalls.push(signal); setImmediate(() => child.emit('close', null, signal)); return true; };
    children.push(child); return child;
  }});
  t.after(async () => { await queue.stop(); fs.rmSync(directory, { recursive:true, force:true }); });
  return { directory, queue, children, engines };
}
function writeGlb(file) {
  const buffer = Buffer.alloc(24); buffer.write('glTF'); buffer.writeUInt32LE(2,4); buffer.writeUInt32LE(24,8); fs.writeFileSync(file, buffer);
}

test('mesh jobs expose stage history and metrics but never a fake image preview', async t => {
  const {queue,children} = fixture(t);
  const job = queue.add({...opts,kind:'mesh',profile:'balanced',sourceJobId:'source-id'},Buffer.from('source mesh'));
  assert.equal(job.inputUrl,null);
  assert.match(queue.jobs[0].inputPath,/source\.glb$/);
  children[0].stdout.write('BROOG_EVENT {"stage":"Cleaning mesh","progress":20}\n');
  children[0].stdout.write('BROOG_EVENT {"stage":"Writing GLB","progress":90,"metrics":{"before":{"bytes":100},"after":{"bytes":60}}}\n');
  assert.equal(queue.jobs[0].stage,'Writing GLB');
  assert.equal(queue.jobs[0].progress,90);
  assert.equal(queue.jobs[0].history.length,2);
  writeGlb(queue.jobs[0].outputPath); children[0].emit('close',0);
  assert.equal(queue.jobs[0].progress,100);
  assert.equal(queue.jobs[0].metrics.after.bytes,60);
  assert.equal(queue.public(queue.jobs[0]).sourceJobId,'source-id');
});

test('sampler steps do not override the named generation stage', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts,Buffer.from('reference'));
  children[0].stdout.write('[3/6] sparse-structure flow + decode\n');
  children[0].stdout.write('[stats] dino projection conditioning\n');
  children[0].stdout.write('[flow] [###.................]  2/12  3.1s\n');
  assert.equal(queue.jobs[0].stage,'Generating structure');
  assert.deepEqual(queue.jobs[0].step,{current:2,total:12});
  children[0].stdout.write('[4/7] shape SLAT flow (512)\n');
  assert.equal(queue.jobs[0].stage,'Generating shape');
  assert.equal(queue.jobs[0].step,undefined);
});
test('serializes engines and only exposes completed GLBs', async t => {
  const {queue,children} = fixture(t);
  const first = queue.add(opts,Buffer.from('image')); const second = queue.add(opts,Buffer.from('image'));
  assert.equal(children.length,1); assert.equal(queue.list()[0].status,'queued');
  assert.equal(queue.list()[1].outputUrl,null);
  writeGlb(queue.jobs[0].outputPath); children[0].emit('close',0);
  assert.equal(queue.jobs[0].status,'complete'); assert.equal(children.length,2);
  assert.equal(queue.list()[1].outputUrl,`/api/jobs/${first.id}/model`);
  queue.cancel(second.id); await queue.active.done;
  assert.equal(queue.jobs[1].status,'cancelled'); assert.equal(queue.active,null);
});

function storageFault(t, method, matches = () => true) {
  const original = fs[method].bind(fs);
  return t.mock.method(fs, method, (...args) => {
    if (matches(...args)) throw Object.assign(new Error('Disk full (injected)'), { code: 'ENOSPC' });
    return original(...args);
  });
}

test('log storage failure stops active work, blocks the queue and reports unsaved state', async t => {
  const {queue,children} = fixture(t);
  const first = queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  const persisted = fs.readFileSync(queue.file, 'utf8');
  const append = storageFault(t, 'appendFileSync');
  assert.doesNotThrow(() => children[0].stdout.write('Generating shape\n'));
  assert.equal(children[0].killCalls.length, 1);
  assert.ok(queue.jobs.every(job => job.status === 'failed'));
  assert.ok(queue.list().every(job => /not saved/.test(job.persistenceError)));
  assert.throws(() => queue.add(opts, Buffer.from('image')), /Storage failure/);
  assert.throws(() => queue.remove(first.id), /Storage failure/);
  children[0].stderr.write('more output\n');
  assert.equal(append.mock.callCount(), 1);
  await active.done;
  assert.equal(queue.active, null);
  assert.equal(children.length, 1);
  assert.equal(fs.readFileSync(queue.file, 'utf8'), persisted);
  assert.match((await queue.stop()).persistenceError, /not saved/);
});

test('completion rename failure never exposes an unpersisted success', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  writeGlb(active.job.outputPath);
  const persisted = fs.readFileSync(queue.file, 'utf8');
  storageFault(t, 'renameSync', (_, destination) => destination === queue.file);
  assert.doesNotThrow(() => children[0].emit('close', 0));
  await active.done;
  assert.equal(queue.active, null);
  assert.equal(active.job.status, 'failed');
  assert.equal(active.job.bytes, undefined);
  assert.equal(queue.public(active.job).outputUrl, null);
  assert.match(active.job.error, /not saved/);
  assert.equal(children[0].killCalls.length, 0);
  assert.equal(children.length, 1);
  assert.equal(fs.readFileSync(queue.file, 'utf8'), persisted);
});

test('a final unterminated log line cannot crash the close callback', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  writeGlb(active.job.outputPath);
  children[0].stdout.write('last line without newline');
  storageFault(t, 'appendFileSync');
  assert.doesNotThrow(() => children[0].emit('close', 0));
  await active.done;
  assert.equal(active.job.status, 'failed');
  assert.match(active.job.persistenceError, /not saved/);
  assert.equal(queue.active, null);
});

test('save failure starting the next job is contained by the close callback', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  writeGlb(active.job.outputPath);
  storageFault(t, 'writeFileSync', (file, data) => file === `${queue.file}.tmp` && JSON.parse(data)[1].status === 'running');
  assert.doesNotThrow(() => children[0].emit('close', 0));
  await active.done;
  assert.equal(queue.jobs[0].status, 'complete');
  assert.equal(queue.jobs[1].status, 'failed');
  assert.match(queue.jobs[1].error, /not saved/);
  assert.equal(children.length, 1);
  assert.equal(queue.active, null);
});

test('cancellation save failure is reported and shutdown still settles', async t => {
  const {queue,children} = fixture(t);
  const first = queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  storageFault(t, 'writeFileSync', file => file === `${queue.file}.tmp`);
  assert.throws(() => queue.cancel(first.id), /not saved/);
  const result = await queue.stop();
  assert.equal(result.stopped, true);
  assert.match(result.persistenceError, /not saved/);
  assert.ok(queue.jobs.every(job => job.status === 'failed'));
  assert.equal(children.length, 1);
});

test('input storage failure rejects admission and stops existing work', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  storageFault(t, 'writeFileSync', file => String(file).endsWith('reference.png'));
  assert.throws(() => queue.add(opts, Buffer.from('image')), /Storage failure/);
  await active.done;
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].status, 'failed');
  assert.equal(children[0].killCalls.length, 1);
});

test('shutdown persistence failure is returned without rejecting shutdown', async t => {
  const {queue} = fixture(t);
  storageFault(t, 'renameSync', (_, destination) => destination === queue.file);
  const result = await queue.stop();
  assert.equal(result.stopped, true);
  assert.match(result.persistenceError, /not saved/);
  assert.throws(() => queue.add(opts, Buffer.from('image')), /Storage failure/);
});

test('failed removal retains the library record instead of claiming success', t => {
  const {queue,children} = fixture(t);
  const first = queue.add(opts, Buffer.from('image'));
  children[0].emit('close', 1);
  const persisted = fs.readFileSync(queue.file, 'utf8');
  storageFault(t, 'renameSync', (_, destination) => destination === queue.file);
  assert.throws(() => queue.remove(first.id), /not saved/);
  assert.equal(queue.jobs[0].id, first.id);
  assert.equal(fs.readFileSync(queue.file, 'utf8'), persisted);
});

test('storage failure and throwing kill do not make shutdown wait indefinitely', { timeout: 2000 }, async t => {
  const {queue,children} = fixture(t, { stopTimeoutMs: 20 });
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  children[0].kill = signal => { children[0].killCalls.push(signal); throw new Error('Kill denied (injected)'); };
  storageFault(t, 'appendFileSync');
  assert.doesNotThrow(() => children[0].stderr.write('engine output\n'));
  const result = await queue.stop();
  assert.equal(result.stopped, false);
  assert.match(result.persistenceError, /not saved/);
  assert.equal(queue.active, active);
  assert.equal(children[0].killCalls.at(-1), 'SIGKILL');
  assert.equal(active.job.status, 'failed');
  assert.match(active.job.error, /Storage failure/);
  children[0].emit('close', 0);
  await active.done;
  assert.equal(queue.active, null);
  assert.equal(active.job.status, 'failed');
});

test('shutdown deadline retains an unconfirmed child and persists an honest failure', { timeout: 2000 }, async t => {
  const {queue,children} = fixture(t, { stopTimeoutMs: 20 });
  queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  children[0].kill = signal => { children[0].killCalls.push(signal); return false; };
  const result = await queue.stop();
  assert.deepEqual(result, { stopped: false, persistenceError: null });
  assert.equal(queue.active, active);
  assert.deepEqual(children[0].killCalls, ['SIGTERM', 'SIGKILL']);
  assert.equal(active.job.status, 'failed');
  assert.equal(active.job.stage, 'Termination unconfirmed');
  assert.match(JSON.parse(fs.readFileSync(queue.file, 'utf8'))[0].error, /did not close/);
  assert.throws(() => queue.add(opts, Buffer.from('image')), /shutting down/);
  children[0].emit('close', null, 'SIGKILL');
  await active.done;
  assert.equal(queue.active, null);
  assert.equal(children.length, 1);
});

test('output stat failure after validation is contained and blocks further work', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts, Buffer.from('image'));
  queue.add(opts, Buffer.from('image'));
  const active = queue.active;
  writeGlb(active.job.outputPath);
  let outputStats = 0;
  storageFault(t, 'statSync', file => file === active.job.outputPath && ++outputStats === 2);
  assert.doesNotThrow(() => children[0].emit('close', 0));
  await active.done;
  assert.equal(active.job.status, 'failed');
  assert.equal(queue.public(active.job).outputUrl, null);
  assert.match(active.job.persistenceError, /not saved/);
  assert.equal(children.length, 1);
});
test('failed engine output is not falsely treated as success', t => {
  const {queue,children} = fixture(t);
  queue.add(opts,Buffer.from('image')); fs.writeFileSync(queue.jobs[0].outputPath,'broken');
  children[0].emit('close',0); assert.equal(queue.jobs[0].status,'failed');
  assert.equal(queue.list()[0].outputUrl,null);
});
test('logs GPU memory failures and releases the active job', t => {
  const {queue,children} = fixture(t);
  queue.add(opts,Buffer.from('image')); children[0].stderr.write('CUDA out of memory\n'); children[0].emit('close',1);
  assert.match(queue.jobs[0].error,/GPU memory exhausted/); assert.equal(queue.active,null);
});
test('cancels queued jobs without starting a second engine', async t => {
  const {queue,children} = fixture(t);
  queue.add(opts,Buffer.from('image')); const second = queue.add(opts,Buffer.from('image'));
  queue.cancel(second.id); children[0].emit('close',1);
  assert.equal(children.length,1); assert.equal(queue.jobs[1].status,'cancelled');
});
test('shutdown cancels active and queued work', async t => {
  const {queue} = fixture(t); queue.add(opts,Buffer.from('image')); queue.add(opts,Buffer.from('image'));
  await queue.stop(); assert.equal(queue.active,null); assert.ok(queue.jobs.every(j => j.status === 'cancelled'));
  assert.throws(() => queue.add(opts,Buffer.from('image')),/shutting down/);
});
test('restart marks unfinished jobs interrupted instead of auto-running', async t => {
  const {queue,directory,engines} = fixture(t); queue.add(opts,Buffer.from('image'));
  const recovered = new JobQueue({ directory, engines });
  assert.equal(recovered.jobs[0].status,'failed'); assert.match(recovered.jobs[0].error,/Interrupted/);
});
test('removal preserves asset files and rejects active jobs', t => {
  const {queue,children} = fixture(t); const job = queue.add(opts,Buffer.from('image'));
  assert.throws(() => queue.remove(job.id),/Cancel/);
  const input = queue.jobs[0].inputPath; children[0].emit('close',1); queue.remove(job.id);
  assert.equal(queue.jobs.length,0); assert.ok(fs.existsSync(input));
});
test('validation refuses command injection and uninstalled resolutions', t => {
  const {engines} = fixture(t);
  assert.deepEqual(validateOptions(opts, engines),opts);
  assert.throws(() => validateOptions({...opts,seed:'42 & calc'},engines),/Seed/);
  assert.throws(() => validateOptions({...opts,resolution:1024},engines),/Resolution/);
  assert.throws(() => validateOptions({...opts,engineId:'other'},engines),/Unknown/);
});
test('GLB header validation rejects truncated files', t => {
  const {directory} = fixture(t); const file = path.join(directory,'a.glb');
  writeGlb(file); assert.equal(validGlb(file),true); fs.truncateSync(file,20); assert.equal(validGlb(file),false);
});
