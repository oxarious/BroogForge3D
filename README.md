# BroogForge

Local-first, multi-engine 3D asset studio for BroogDesign. No hosted inference,
subscriptions, API keys or cloud uploads. TRELLIS.2 and Pixal3D generation adapters,
a UniRig rigging adapter, and glTF Transform optimization share one local job queue.
Adapters are not a promise of hardware compatibility: the Engines view reports
which runtimes and weights are actually available.

## Working From GitHub

This repository contains the app source, setup scripts, tests and documentation.
Model weights, engine checkouts/runtimes, dependencies, local jobs, generated
exports and verification artifacts are not uploaded. Each collaborator installs
their own dependencies and engines; existing assets remain on the original PC.

Clone and prepare the app on Windows with Git, Node.js 22+ and pnpm installed:

```powershell
git clone https://github.com/oxarious/BroogForge3D.git
cd BroogForge3D
pnpm install --frozen-lockfile
git clone https://github.com/pwilkin/trellis.cpp.git vendor/trellis.cpp
git -C vendor/trellis.cpp checkout 883346efb49bd3b46875ea996cb9f195b954d525
New-Item -ItemType Directory -Force data | Out-Null
pnpm run build:effects
pnpm test
pnpm check
```

The pinned upstream checkout supplies the local model viewer. The effects build
also generates the local metadata used by its tests. Start the app using the
instructions below. Generation requires separate engine/model installation;
see [engine setup](docs/engine-setup.md), [integrations](docs/integrations.md) and
[texturing](docs/texturing.md). Some verification/export scripts record paths
from the original PC and need local input paths before use.

For changes, create a feature branch from an up-to-date `main`, push that branch
and open a pull request. Keep credentials in ignored local files, and do not
force-add models, runtimes or generated exports to Git.

## Start and Stop

Double-click `BroogForge.cmd`, run `Start BroogForge.ps1` with PowerShell, or use
`node server/index.js` in this folder.
The launcher opens the actual free local port (8790 by default). The web interface
binds only to 127.0.0.1. Use the power button or `Stop BroogForge.ps1` to stop the
server and cancel active generation. Closing a browser tab does not stop a job.
No login startup task or background Windows service is installed.

Dependencies: Node.js 22+, `pnpm install` (or `npm install`). The current computer
also has a bundled Node runtime which the launcher detects automatically.

## Generate

Install the engine with `scripts/setup-trellis.ps1`. Use a clear single-subject PNG,
JPEG or WebP reference, preferably with a transparent background. Uploads are
validated and converted to PNG locally, capped at 15 MB and 25 million pixels.
Choose TRELLIS.2 Q4 and generate at 512. Jobs run sequentially; the CLI exits after
each generation, releasing model memory. Download the completed GLB from the viewer.
The model does not automatically produce rigging or animation.

The 512 pipeline passed a real textured chest generation on this computer in
194.5 seconds (5.47 MB GLB). Other references may use more resources or fail.
The 8 GB RTX 5070 Laptop GPU is a constraint, not a universal compatibility promise. Q4
reduces model size but decoded geometry and temporary GPU buffers also use memory.
Higher-resolution choices stay disabled until their weights and hardware are tested.
Raw GLBs may be too large for a website: review topology, texture size and rendering
cost before deployment. No optimization or quality guarantee is implied by export.

## Texturing

The Texturing workspace controls a separate local Forge runtime with SD1.5,
ControlNet Depth and IP-Adapter Plus. It generates reference-guided 2D projections
and prepares UV-ready asset copies for the separate StableProjectorz desktop
editor. Full-model painting and texture export remain manual; generated PNGs are
not presented as finished textured GLBs. See `docs/texturing.md` for the workflow,
verified test, installation records, licensing and limitations.

Use Stop backend after texturing to release GPU memory. Stop it before starting
the 3D queue. The main app's shutdown also stops its owned Forge process.

## Storage

- `vendor/trellis.cpp`: unmodified upstream source checkout.
- `runtime/trellis-cuda`: pinned executable and CUDA libraries.
- `models/trellis-q4`: verified model files.
- `data/jobs`: input images, GLBs, generation logs and persistent queue metadata.
- `artifacts`: local verification screenshots and test results.

## Process Dashboard

Open the Process tab for GPU utilization/memory/temperature, active queue counts,
stage history, elapsed time, worker logs, source lineage and output metrics.
GPU telemetry is sampled every five seconds. Worker stage progress is not a time
remaining estimate. Generators without structured progress use an indeterminate bar.

Choose a completed asset from the library or upload a self-contained GLB up to
64 MB. glTF Transform has three profiles: Balanced (65% or 150k triangle target,
whichever is lower, WebP up to 2048 px), Compact (35% or 60k, WebP up to 1024 px), and Cleanup only (deduplicate,
prune and weld without texture re-encoding). Geometric error limits can prevent
reaching the target ratio. These are lossy operations except for cleanup; compare
the preview with the original. Each operation creates a separate asset and retains
the source. Existing skinning/animation is preserved by the pipeline's cleanup test.

Pixal3D and TRELLIS are alternative generators, not sequential quality passes.
UniRig takes geometry and predicts a rig; it does not invent animation clips.
An operational chain is generation -> optional rigging -> optimization.
See `docs/integrations.md` for installation constraints and verified capabilities.

Removing a library entry preserves its files on disk. Unfinished jobs are marked
interrupted after restart; they are not silently rerun. Model installation uses the
internet; generation uses local files. All viewer scripts are served locally.

## Adding Engines

`server/engines.js` is the engine registry. Each adapter has stable id, display name,
supported resolutions, `status()` and `command(job)` returning an executable and
argument array. Queueing, persistence, cancellation, previews and downloads are
engine-independent. Use a dedicated environment per engine and export GLB. Never
take executable paths or shell commands from browser requests. Remove the matching
unavailable placeholder only when the real adapter is ready.

## Development and Verification

`pnpm test` runs queue, cancellation, persistence and validation tests.
`pnpm check` checks JavaScript syntax. UI and real engine smoke-test findings are
recorded in `docs/verification.md`. Mock tests are not evidence of GPU compatibility.

## Upstream and Licensing

trellis.cpp: https://github.com/pwilkin/trellis.cpp (MIT), source revision
883346efb49bd3b46875ea996cb9f195b954d525 at initial checkout. Runtime release v0.6.0.
Microsoft TRELLIS.2: https://huggingface.co/microsoft/TRELLIS.2-4B (MIT).
Community GGUF conversion: https://huggingface.co/ilintar/trellis2-gguf.
Preserve upstream notices. Helper models, including DINOv3, have their own terms;
MIT on the main project is not blanket clearance for every component. Review all
applicable terms before distributing a bundled installer or commercial assets.
model-viewer is served from the upstream app bundle. UI icons: Lucide (ISC).
