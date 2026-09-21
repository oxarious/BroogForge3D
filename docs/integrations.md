# Additional Integrations

## Sources

- Pixal3D: https://github.com/TencentARC/Pixal3D
  source `f7cf38429b0bd264f1995f0f8743a88b1c728b94`.
- UniRig: https://github.com/VAST-AI-Research/UniRig
  source `6793c6640ff01c8fb389f3993434124bb43d2933`.
- glTF Transform: https://github.com/donmccurdy/glTF-Transform
  source `a5d768b87efaae1fa65ddd17cd551a45b57abd70`.
  The application uses released npm packages 4.5.0, not an unbuilt Git checkout.
- Pixal inference port: existing `vendor/trellis.cpp`, source revision
  `883346efb49bd3b46875ea996cb9f195b954d525`.

These upstream repositories have MIT licenses for their own code. Preserve their
notices. Dependencies and helper models have separate licenses; cloning a repo is
not blanket commercial clearance for all its dependencies or datasets.

## glTF Transform

Operational locally in `workers/optimize.mjs`, called through the serial job queue.
Uses core/extensions/functions, MeshoptSimplifier and Sharp. Both uploaded and
existing generated GLBs are supported. Browser requests cannot specify executable
paths, shell commands, output paths or external resources. GLB URI references are
rejected and NodeIO networking is disabled. Draco-compressed input is currently
unsupported; export an uncompressed GLB first. Embedded WebP is supported by the
local viewer; check compatibility with the eventual delivery target.

The first measured real asset changed from 5,472,796 to 3,999,976 bytes and from
148,792 to 96,714 triangles with Balanced. This is about 27% smaller and 35% fewer
triangles, not a universal quality/performance guarantee. The input was untouched.
Sharp was aligned to 0.35.0 to avoid conflicting native libvips versions loaded
through glTF Transform's ndarray-pixels dependency on Windows.

## Pixal3D

The official Python implementation is not installed. The integration uses the
community trellis.cpp port with `--model pixal3d`. The original TRELLIS v0.6.0
runtime does not understand this flag and remains separate and unchanged.

`scripts/build-pixal-runtime.ps1` downloads checksum-verified CUDA 13.1 build
components into the project and uses Visual Studio 2022 C++ tools, local CMake
and Ninja to compile for this laptop's SM120 architecture. It does not install
a system-wide CUDA toolkit. Prerequisites: the initialized ggml submodule and
CMake/Ninja available in `runtime/unirig-env/Scripts`.

`scripts/setup-pixal.ps1` installs 5.46 GB of community-converted GGUF weights,
pinned to `vegax87/Pixal3D` revision
`0e8f0e0997949c8de1671c76a19a91aa7f424dfa`, verified with SHA256. Shared decoder,
DINOv3 and background-removal files are hard-linked from the existing TRELLIS
installation to avoid duplicate disk use. Do not modify hard-linked weights in place.

The 512 profile is GEOMETRY ONLY. This port has no 512 Pixal texture flow, no MoGe2
camera estimator, and incomplete parity validation against the official Python
pipeline. Fixed default horizontal FOV is 49.13 degrees. Native compiled inference
still needs a real test on each hardware/input combination. 1024 is deliberately
not offered on this 8 GB installation. Setting direct NAF convolution avoids a
large im2col buffer but does not guarantee that all references fit.

The first raw 512 export completed in 69.5 seconds but was visibly noisy: the
upstream geometry-only GLB path skips the remeshing used by textured exports.
BroogForge therefore uses the port's existing `--dump-post` cleaned-mesh path,
then `workers/pixal.mjs` validates the binary geometry, simplifies towards 150k
triangles, adds explicit surface normals and a neutral material, and exports GLB
with glTF Transform. Upstream source was not patched. Remesh/simplification can
remove small features; this is not parity with the official high-resolution pipeline.

Verified final job `c394de4b-dbbe-4ddc-9d40-66a32eb27f6b` completed in 106.9 seconds
wall time: 149,996 triangles, 12,600,072-byte GLB. Sampled whole-GPU usage peaked at
3,707 MiB (not an exact allocation maximum). Desktop/mobile canvas checks and
visual inspection passed. It remains a geometry-only experimental generator,
not an automatic production-quality character or animation system.

## UniRig

Adapter implemented but native inference is NOT operational on this laptop yet.
Only its isolated Python 3.11 environment has been created. The installation
probe confirms missing Torch, bpy, FlashAttention, spconv and graph extensions.
Binary-only Windows dependency resolution fails for flash-attn and torch-scatter
on the default package index. PyG has separate version-specific wheels; that does
not resolve FlashAttention automatically. WSL is not installed and was not added
silently. No UniRig checkpoint download or paid fallback was started.

`workers/unirig.py` calls the upstream extraction, skeleton prediction, extraction
of the skeleton, skinning, and merge stages using explicit Python argument arrays.
It uses per-job outputs, refuses missing intermediate exports, and runs with
Hugging Face/Transformers offline flags. Cancellation targets its owned Windows
process tree. Wrapper tests simulate subprocesses and do NOT verify rigging quality.

To activate, a compatible CUDA PyTorch 3.11 environment needs the upstream
requirements, FlashAttention, spconv, torch-scatter and torch-cluster, plus cached
`VAST-AI/UniRig` skeleton/articulation-xl_quantization_256/model.ckpt and
skin/articulation-xl/model.ckpt and facebook/opt-350m configuration. The app uses
`models/unirig-cache` as HF_HOME. Then run:

```powershell
runtime/unirig-env/Scripts/python.exe scripts/probe-unirig.py
```

A successful offline preflight enables the adapter for 24 hours. Preflight is not
an inference benchmark; run a complete rigging test before using it for client
assets. Skeleton quality often needs human refinement before skinning. UniRig
does not make a stiff character expressive on its own; animation still needs
clips, posing, facial controls or a separate animation pipeline.
