// Mesh uploads must be self-contained GLB 2.0, never arbitrary file references.
export function validateGlb(data) {
  if (!Buffer.isBuffer(data) || data.length < 28 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error('Choose a valid GLB 2.0 file.');
  const length = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4E4F534A || length < 2 || length > 16 * 1024 * 1024 || 20 + length > data.length) throw new Error('Invalid GLB JSON chunk.');
  let json;
  try { json = JSON.parse(data.subarray(20, 20 + length).toString('utf8')); } catch { throw new Error('Invalid GLB JSON.'); }
  if (json.asset?.version !== '2.0' || !Array.isArray(json.meshes) || !json.meshes.length) throw new Error('The GLB must contain a mesh.');
  for (const item of [...(json.buffers || []), ...(json.images || [])]) if (item.uri) throw new Error('External or data-URI resources are not accepted. Export a self-contained GLB.');
  return json;
}
