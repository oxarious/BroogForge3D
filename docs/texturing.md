# Local Texturing

## Installed and Verified

- Forge source: https://github.com/lllyasviel/stable-diffusion-webui-forge
  Revision `dfdcbab685e57677014f05a3309b48cc87383167`.
- IP-Adapter reference source: https://github.com/tencent-ailab/IP-Adapter
- ControlNet reference source: https://github.com/lllyasviel/ControlNet-v1-1-nightly
- Forge's built-in ControlNet implementation executes both conditioning models.
  The reference repositories are not separate inference servers.
- Isolated Python 3.10.19, PyTorch 2.7.1 CUDA 12.8, NVIDIA RTX 5070 Laptop (8 GB).
- SD1.5 EMA, ControlNet v1.1 Depth, IP-Adapter Plus SD1.5, CLIP ViT-H encoder.
  All four downloaded weight files passed SHA256 verification against their
  pinned Hugging Face revisions. See `runtime/texture-models.json`.
- StableProjectorz 2.4.5 portable desktop application, installed separately.

The 2026-09-21 smoke test used the actual Pixal Broog mesh depth rendered in
Blender, the original approved reference and both conditioning units. It produced
a 512 x 512 PNG in about 30 seconds including first inference model loading.
Five-second GPU sampling observed 3127 MB total used, not a guaranteed peak bound.
Backend startup is separate (about 32 seconds on the tested warm launch).
See `artifacts/texture-report.json` and `artifacts/texture-inference.log`.

## Use

1. Open Texturing in BroogForge. Start backend; wait for Ready.
2. For a projection test, choose a character reference and a mesh depth PNG,
   describe the appearance, and Generate projection. Review or download the PNG.
3. For full texture painting, select a library asset and Prepare asset. The
   output folder contains the original GLB, reference and a UV-ready OBJ copy.
   Existing UVs are preserved; missing UVs are automatically unwrapped in Blender.
4. Open editor. In StableProjectorz, set its WebUI address to the address shown
   in BroogForge. Import `mesh-uv.obj` from the prepared folder. Choose SD1.5,
   ControlNet Depth and IP-Adapter Plus using the reference image.
5. Paint/project from multiple views, review seams and save the editor project.
   Export textures from StableProjectorz. Reapply them in Blender and export GLB
   before importing it into BroogForge for optimization.
6. Stop backend to release its model memory. Close StableProjectorz separately
   when finished. It is a user-controlled desktop application.

Depth test input: `exports/broog-depth.png`.
Latest tested handoff: `exports/texture-handoffs/7602dd02-6627-48db-9521-f1ef13bf6354`.
Automated UV unwrap is a starting point, not production-quality topology or seams.
The OBJ copy is for painting, not a rig/animation-preserving replacement asset.

## Boundaries

The dashboard projection is a 2D image, NOT a baked texture atlas or textured GLB.
Full-mesh painting/export is a manual handoff. The newer StableProjectorz source
has an agent bridge, but its available 2.4.5 binary predates that bridge. A build
attempt was blocked because this computer has no activated Unity Editor license.
No automation bridge is claimed or enabled. No website asset has been replaced.

Runtime inference is local and offline. Forge binds explicitly to 127.0.0.1 on a
free port, loads only built-in extensions, disables runtime package installation,
and uses installed model weights. Start/Stop are explicit; no startup service is
installed. The 3D queue and texture backend cannot run simultaneously. An inference
failure stops the owned Forge process to avoid leaving GPU work running.

## Reproducibility and Licensing

Model downloads: `node scripts/setup-texture-models.mjs` (internet needed once).
Runtime probe: `node scripts/verify-texture-runtime.mjs`.
Dependency snapshot: `runtime/forge-requirements.lock.txt`.
Projection smoke test: `node scripts/verify-texture-projection.mjs`.
Blender path can be overridden with `BROOGFORGE_BLENDER`.

Forge and StableProjectorz have AGPL licensing obligations. Keep their notices
and sources available as required when modifying/distributing them. The local
StableProjectorz source includes a small custom Unity build entry point; it was
not compiled successfully. Do not market third-party code as proprietary code.
IP-Adapter uses Apache 2.0; SD1.5 and ControlNet weights carry OpenRAIL terms.
The selected adapter is regular Plus, NOT FaceID/InsightFace. Free local use does
not mean every component or generated asset is unrestricted. Review the bundled
licenses before redistribution or commercial product packaging.
