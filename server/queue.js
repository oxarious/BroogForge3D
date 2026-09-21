import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export function validGlb(file) {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, 12, 0);
      return header.toString('ascii', 0, 4) === 'glTF' && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === stat.size && stat.size > 20;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

export class JobQueue {
  constructor({ directory, engines, spawnProcess = spawn, stopTimeoutMs = 5000 }) {
    this.directory = directory;
    this.engines = engines;
    this.spawnProcess = spawnProcess;
    this.stopTimeoutMs = stopTimeoutMs;
    this.active = null;
    this.stopping = false;
    this.storageError = null;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'jobs.json');
    this.jobs = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    // A restarted application must never silently restart an expensive GPU task.
    for (const job of this.jobs) {
      if (['running','queued'].includes(job.status)) {
        job.status = 'failed'; job.error = 'Interrupted by application shutdown. Submit again to retry.';
        job.stage = 'Interrupted';
      }
    }
    this.save();
  }
  save() {
    if (this.storageError) throw this.storageError;
    try {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.jobs, null, 2));
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { throw this.failStorage(error); }
  }
  failStorage(error, affected = this.active?.job) {
    // This failure state is memory-only; do not resume writes or work until restart.
    if (!this.storageError) {
      this.storageError = new Error(`Storage failure: ${error.message}. Job state was not saved. Fix storage and restart the application.`, { cause: error });
      this.stopping = true;
      console.error(this.storageError.message);
    }
    for (const job of this.jobs) {
      if (job === affected || ['queued', 'running'].includes(job.status)) {
        job.status = 'failed'; job.stage = 'Storage failure';
        job.error = this.storageError.message;
        job.persistenceError = this.storageError.message;
        delete job.bytes;
      }
    }
    if (this.active && !this.active.closed && !this.active.storageKillRequested) {
      this.active.storageKillRequested = true;
      clearTimeout(this.active.timeout);
      this.terminate(this.active);
    }
    return this.storageError;
  }
  terminate(active, signal = 'SIGTERM') {
    try {
      if (process.platform === 'win32' && this.spawnProcess === spawn && ['unirig','pixal3d'].includes(active.job.engineId) && active.child.pid && !active.closed) {
        const killer = spawn('taskkill.exe', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', error => console.error(`Process-tree termination failed: ${error.message}`));
        return;
      }
      if (!active.child.kill(signal)) console.error('Engine termination was not confirmed; still waiting for close.');
    } catch (error) { console.error(`Unable to terminate engine: ${error.message}`); }
  }
  list() { return [...this.jobs].reverse().map(job => this.public(job)); }
  public(job) {
    const { inputPath, outputPath, ...visible } = job;
    return { ...visible, inputUrl: job.kind === 'mesh' ? null : `/api/jobs/${job.id}/input`, outputUrl: job.status === 'complete' ? `/api/jobs/${job.id}/model` : null };
  }
  add(options, png) {
    if (this.storageError) throw this.storageError;
    if (this.stopping) throw new Error('Application is shutting down.');
    if (this.jobs.filter(job => ['queued','running'].includes(job.status)).length >= 10) throw new Error('Queue is full (10 jobs).');
    const id = randomUUID();
    const folder = path.join(this.directory, id);
    const job = { id, ...options, status: 'queued', stage: 'Queued', createdAt: new Date().toISOString(), log: [], history: [], inputPath: path.join(folder, options.kind === 'mesh' ? 'source.glb' : 'reference.png'), outputPath: path.join(folder, 'model.glb') };
    try {
      fs.mkdirSync(folder);
      fs.writeFileSync(job.inputPath, png);
      this.jobs.push(job); this.save();
    } catch (error) { throw this.failStorage(error); }
    this.pump();
    return this.public(job);
  }
  pump() {
    if (this.active || this.stopping) return;
    const job = this.jobs.find(j => j.status === 'queued');
    if (!job) return;
    const engine = this.engines.get(job.engineId);
    const health = engine?.status();
    if (!health?.installed) {
      job.status = 'failed'; job.error = health?.reason || 'Engine unavailable'; this.save(); this.pump(); return;
    }
    job.status = 'running'; job.stage = 'Starting engine'; job.startedAt = new Date().toISOString(); this.save();
    let child;
    try {
      const command = engine.command(job);
      child = this.spawnProcess(command.executable, command.args, { cwd: command.cwd, env: { ...process.env, ...command.env }, windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] });
    } catch (error) { job.status = 'failed'; job.error = error.message; this.save(); this.pump(); return; }
    const active = { job, child, cancelled: false };
    this.active = active;
    let partial = '';
    const append = line => {
      if (this.storageError) return;
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 1500).trim();
      if (!clean) return;
      const previousStage = job.stage;
      job.log.push(clean); job.log = job.log.slice(-160);
      try { fs.appendFileSync(path.join(path.dirname(job.inputPath), 'generation.log'), `${clean}\n`); }
      catch (error) { this.failStorage(error); return; }
      const header = /^\[\d+\/[67]\]/.test(clean);
      if (header) { job.headerStages = true; delete job.step; }
      if (header || !job.headerStages) {
        if (/birefnet|background|preprocess/i.test(clean)) job.stage = 'Preparing reference';
        if (/dino|conditioning/i.test(clean)) job.stage = 'Encoding image';
        if (/ss.flow|sparse.structure/i.test(clean)) job.stage = 'Generating structure';
        if (/shape|slat/i.test(clean)) job.stage = 'Generating shape';
        if (/tex.flow|texture|PBR/i.test(clean)) job.stage = 'Generating materials';
        if (/remesh|decimat|unwrap|bake|atlas|shape decode/i.test(clean)) job.stage = 'Building mesh and UVs';
        if (header && /write|export|cleaned dump/i.test(clean)) job.stage = 'Exporting asset';
      }
      const step = clean.match(/^\[flow\]\s+\[[#.]+\]\s+(\d+)\/(\d+)/);
      if (step && Number(step[2]) > 0) job.step = { current:Number(step[1]), total:Number(step[2]) };
      if (clean.startsWith('BROOG_EVENT ')) {
        try {
          const event = JSON.parse(clean.slice(12));
          if (typeof event.stage === 'string') job.stage = event.stage.slice(0, 100);
          if (Number.isFinite(event.progress)) job.progress = Math.max(0, Math.min(100, event.progress));
          if (event.metrics && typeof event.metrics === 'object') job.metrics = event.metrics;
          if (event.geometry && typeof event.geometry === 'object') job.geometry = event.geometry;
        } catch { /* Keep malformed worker events in the diagnostic log. */ }
      }
      if (job.stage !== previousStage) {
        job.history ||= [];
        job.history.push({ stage: job.stage, at: new Date().toISOString() });
        job.history = job.history.slice(-40);
      }
    };
    const consume = chunk => {
      if (this.storageError) return;
      partial += chunk.toString(); const lines = partial.split(/[\r\n]+/); partial = lines.pop().slice(-3000);
      lines.forEach(append);
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('error', error => { if (!this.storageError) job.error = error.message; });
    active.timeout = setTimeout(() => { job.error = 'Generation exceeded the 30-minute limit.'; this.terminate(active); }, 30 * 60 * 1000);
    active.done = new Promise(resolve => child.once('close', (code, signal) => {
      active.closed = true;
      clearTimeout(active.timeout);
      try {
        if (partial) append(partial);
        job.finishedAt = new Date().toISOString();
        if (this.storageError) this.failStorage(this.storageError, job);
        else {
          if (active.cancelled) { job.status = 'cancelled'; job.stage = 'Cancelled'; }
          else if (!job.error && code === 0 && validGlb(job.outputPath)) {
            job.bytes = fs.statSync(job.outputPath).size; job.status = 'complete'; job.stage = 'Ready'; job.progress = 100;
          } else {
            job.status = 'failed'; job.stage = 'Generation failed';
            job.error ||= /out of memory|cuda.*alloc|insufficient memory/i.test(job.log.join('\n'))
              ? 'GPU memory exhausted. Close other GPU-heavy applications before retrying. This configuration may not fit 8 GB.'
              : `Engine exited without a valid GLB (exit ${code ?? signal}). Check the generation log.`;
          }
          this.save();
        }
      } catch (error) { this.failStorage(error, job); }
      finally { this.active = null; resolve(); }
      // pump can persist the next job from this event callback, too.
      try { this.pump(); } catch (error) { this.failStorage(error); }
    }));
  }
  cancel(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;
    if (this.active?.job.id === id) { this.active.cancelled = true; if (!this.storageError) job.stage = 'Cancelling'; this.terminate(this.active); }
    else if (job.status === 'queued') { job.status = 'cancelled'; job.stage = 'Cancelled'; }
    this.save(); return true;
  }
  remove(id) {
    if (this.storageError) throw this.storageError;
    const job = this.jobs.find(j => j.id === id);
    if (!job) return false;
    if (['queued','running'].includes(job.status)) throw new Error('Cancel the job before removing it.');
    // Keep original assets on disk; removing a library record is not file deletion.
    const previous = this.jobs;
    this.jobs = this.jobs.filter(j => j.id !== id);
    try { this.save(); } catch (error) { this.jobs = previous; throw error; }
    return true;
  }
  async stop() {
    this.stopping = true;
    for (const job of this.jobs) if (job.status === 'queued') { job.status = 'cancelled'; job.stage = 'Cancelled on shutdown'; }
    const active = this.active;
    if (active) {
      active.cancelled = true;
      if (!this.storageError) active.job.stage = 'Cancelling';
      this.terminate(active);
      let timer;
      try {
        await Promise.race([active.done, new Promise(resolve => { timer = setTimeout(resolve, this.stopTimeoutMs); })]);
      } finally { clearTimeout(timer); }
      if (this.active === active) {
        clearTimeout(active.timeout);
        this.terminate(active, 'SIGKILL');
        console.error('Engine did not close before shutdown deadline; termination is unconfirmed.');
        if (!this.storageError) {
          active.job.status = 'failed'; active.job.stage = 'Termination unconfirmed';
          active.job.error = 'Engine did not close before shutdown deadline. Check the process before restarting.';
        }
      }
    }
    try { this.save(); } catch { /* failStorage already reported the unsaved state. */ }
    return { stopped: this.active === null, persistenceError: this.storageError?.message ?? null };
  }
}
