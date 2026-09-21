import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specs = [
  ['stable-diffusion-v1-5/stable-diffusion-v1-5', 'v1-5-pruned-emaonly.safetensors', 'Stable-diffusion/sd15.safetensors'],
  ['lllyasviel/ControlNet-v1-1', 'control_v11f1p_sd15_depth.pth', 'ControlNet/control_v11f1p_sd15_depth.pth'],
  ['h94/IP-Adapter', 'models/ip-adapter-plus_sd15.safetensors', 'ControlNet/ip-adapter-plus_sd15.safetensors'],
  ['h94/IP-Adapter', 'models/image_encoder/model.safetensors', 'ControlNetPreprocessor/CLIP-ViT-H-14.safetensors'],
];
const digest = async file => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const metadata = new Map();
const receipts = [];
for (const [repo, filename, relative] of specs) {
  if (!metadata.has(repo)) {
    const response = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`);
    if (!response.ok) throw new Error(`Model metadata: ${response.status}`);
    metadata.set(repo, await response.json());
  }
  const info = metadata.get(repo);
  const entry = info.siblings.find(file => file.rfilename === filename);
  if (!entry?.lfs?.sha256) throw new Error(`No published SHA256 for ${repo}/${filename}`);
  const destination = path.join(root, 'vendor/Forge/models', relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!(fs.existsSync(destination) && await digest(destination) === entry.lfs.sha256)) {
    if (fs.existsSync(destination)) throw new Error(`Existing model hash mismatch: ${destination}`);
    console.log(`Downloading ${filename} (${(entry.size / 1e9).toFixed(2)} GB)`);
    const partial = `${destination}.partial`;
    const result = spawnSync('curl.exe', ['--fail', '--location', '--retry', '3', '--silent', '--show-error', '--continue-at', '-', `https://huggingface.co/${repo}/resolve/${info.sha}/${filename}`, '--output', partial], { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error(`Download failed: ${filename}`);
    if (await digest(partial) !== entry.lfs.sha256) throw new Error(`SHA256 mismatch: ${partial}`);
    fs.renameSync(partial, destination);
  }
  receipts.push({ repo, revision: info.sha, filename, sha256: entry.lfs.sha256, bytes: entry.size, destination: relative });
  console.log(`Verified ${filename}`);
}
fs.writeFileSync(path.join(root, 'runtime/texture-models.json'), JSON.stringify({ checkedAt: new Date().toISOString(), models: receipts }, null, 2));
