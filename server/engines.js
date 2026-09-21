import fs from 'node:fs';
import path from 'node:path';

const required = ['birefnet', 'dinov3', 'ss_flow', 'ss_dec', 'shape_flow_512', 'shape_dec', 'tex_flow_512', 'tex_dec'];

export function createEngines(root) {
  const runtime = path.join(root, 'runtime/trellis-cuda');
  const models = path.join(root, 'models/trellis-q4');
  const executable = path.join(runtime, 'trellis-cli.exe');
  const trellis = {
    id: 'trellis-q4', name: 'TRELLIS.2 / Q4', kind: 'image',
    description: 'Local image-to-3D with textured GLB output. 512 resolution; experimental on 8 GB VRAM.',
    resolutions: [512],
    status() {
      const missing = required.filter(name => {
        const file = path.join(models, `${name}.gguf`);
        try {
          const fd = fs.openSync(file, 'r');
          try { const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); return head.toString() !== 'GGUF'; }
          finally { fs.closeSync(fd); }
        } catch { return true; }
      });
      if (!fs.existsSync(executable)) return { installed: false, reason: 'CUDA runtime not installed. Run scripts/setup-trellis.ps1.' };
      return { installed: missing.length === 0, reason: missing.length ? `Model download incomplete: ${missing.join(', ')}` : 'Local engine ready. GPU compatibility is checked during generation.' };
    },
    command(job) {
      return { executable, cwd: runtime, args: [job.inputPath, job.outputPath,
        '--models', models, '--res', String(job.resolution), '--seed', String(job.seed),
        '--gpu', '0', '--require-gpu', '--atlas', '1024', '--threads', '8'] };
    }
  };
  const pixalRuntime = path.join(root, 'runtime/pixal-cuda');
  const pixalModels = path.join(root, 'models/pixal3d');
  const pixal = {
    id: 'pixal3d', name: 'Pixal3D / 512', kind: 'image', resolutions: [512],
    repository: 'https://github.com/TencentARC/Pixal3D',
    description: 'Experimental pixel-aligned geometry via trellis.cpp. 512 output has no textures. One real generation passed on this 8 GB laptop; other inputs may differ.',
    status() {
      if (!fs.existsSync(path.join(pixalRuntime, 'trellis-cli.exe'))) return { installed: false, reason: 'CUDA runtime needs building: scripts/build-pixal-runtime.ps1' };
      const names = ['pixal3d_ss_flow','pixal3d_shape_flow_512','pixal3d_naf','ss_dec','shape_dec','tex_dec','birefnet','dinov3'];
      if (!names.every(n => fs.existsSync(path.join(pixalModels, `${n}.gguf`))) || !fs.existsSync(path.join(pixalModels, 'verified.json'))) return { installed: false, reason: 'Weights need verified installation: scripts/setup-pixal.ps1 (5.46 GB).' };
      return { installed: true, reason: 'Experimental local runtime and verified weights available. Geometry only.' };
    },
    command(job) {
      return { executable: process.execPath, cwd: root,
        env: { TRELLIS_NAF_CONV_DIRECT: '1' },
        args: [path.join(root,'workers/pixal.mjs'), path.join(pixalRuntime,'trellis-cli.exe'), pixalModels, job.inputPath, job.outputPath, String(job.seed)] };
    }
  };
  const optimize = {
    id: 'gltf-transform', name: 'glTF Transform', kind: 'mesh', resolutions: [],
    repository: 'https://github.com/donmccurdy/glTF-Transform',
    description: 'Mesh cleanup, optional simplification and embedded WebP textures. Original assets are preserved.',
    status: () => ({ installed: true, reason: 'Local Node runtime ready. No GPU required.' }),
    command: job => ({ executable: process.execPath, cwd: root, args: [path.join(root, 'workers/optimize.mjs'), job.inputPath, job.outputPath, job.profile || 'balanced'] })
  };
  const unirig = {
    id: 'unirig', name: 'UniRig', kind: 'mesh', resolutions: [],
    repository: 'https://github.com/VAST-AI-Research/UniRig',
    description: 'Skeleton prediction, skin weights and rigged GLB export. Rigging does not generate animation clips.',
    status() {
      try {
        const report = JSON.parse(fs.readFileSync(path.join(root, 'runtime/unirig-health.json'), 'utf8'));
        if (report.ready && Date.now() - Date.parse(report.checkedAt) < 86400000) return { installed: true, reason: 'Local preflight passed. Rig quality still requires review.' };
        if (report.ready) return { installed: false, reason: 'Preflight expired. Run scripts/probe-unirig.py in the local UniRig environment again.' };
        return { installed: false, reason: report.reason || 'Run scripts/probe-unirig.py in a fully installed UniRig environment.' };
      } catch { return { installed: false, reason: 'Windows runtime blocked: FlashAttention and compiled PyTorch extensions are missing. Adapter added; inference not yet available.' }; }
    },
    command: job => ({ executable: path.join(root, 'runtime/unirig-env/Scripts/python.exe'), cwd: path.join(root, 'vendor/UniRig'),
      env: { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', WANDB_MODE: 'disabled', HF_HOME: path.join(root, 'models/unirig-cache') },
      args: ['-u', path.join(root, 'workers/unirig.py'), job.inputPath, job.outputPath, String(job.seed || 42)] })
  };
  const entries = [trellis, pixal, unirig, optimize];
  return {
    list: () => entries.map(({id,name,description,resolutions,status,kind,repository}) => ({ id,name,description,resolutions,kind,repository,...status() })),
    get: id => entries.find(engine => engine.id === id)
  };
}

export function validateOptions(body, registry) {
  const engine = registry.get(body.engineId);
  if (!engine) throw new Error('Unknown engine.');
  if (engine.kind !== 'image') throw new Error('This engine requires a GLB asset, not an image.');
  const resolution = Number(body.resolution ?? 512);
  const seed = Number(body.seed ?? 42);
  if (!engine.resolutions.includes(resolution)) throw new Error('Resolution not supported by this engine installation.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('Seed must be an integer between 0 and 2147483647.');
  const health = engine.status();
  if (!health.installed) throw new Error(health.reason);
  return { engineId: engine.id, resolution, seed };
}
