# Local Engine Setup

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-trellis.ps1`
from BroogForge (PowerShell 7 also works). Requires Windows x64, curl.exe, internet,
and a compatible NVIDIA driver. No Python, HF login, paid service, global PATH,
AppData configuration, desktop installer, or GPU generation is used.

The installer pins [trellis.cpp v0.6.0](https://github.com/pwilkin/trellis.cpp/releases/tag/v0.6.0)
and its CUDA 13.1 Windows bundle (Turing or newer). It verifies the GitHub asset
SHA256 digest and size before extracting to `runtime/trellis-cuda/`. The CLI,
server binary, GGML DLLs and bundled CUDA DLLs remain together.

Models come only from [ilintar/trellis2-gguf](https://huggingface.co/ilintar/trellis2-gguf),
pinned revision `a57397bd3d351599d9729fc144b3f87c3f87d65b`, under `q4/`.
The v0.6.0 official installer manifest supplies the shared/512 list:
`birefnet`, `dinov3`, `ss_flow`, `ss_dec`, `shape_flow_512`, `shape_dec`,
`tex_flow_512`, `tex_dec`. All eight GGUFs go to `models/trellis-q4/`.
Both 1024 flows are deliberately skipped. Each file must exist in the HF API
and match its LFS size and SHA256. Missing files fail before large downloads;
there is no silent precision/source fallback. Setup also verifies each model's
first four bytes are `GGUF` before recording completion.

Downloads use resumable curl `.part` files and rename only after verification.
Rerunning verifies existing files and resumes partial downloads. A corrupted
complete/partial file is preserved and reported; inspect it before removing
that individual file and retrying. Simultaneous setups are blocked by a lock.
Runtime replacement is refused if an existing runtime differs from the pin.

`runtime/setup-cache/metadata/installation-manifest.json` records source URLs,
revisions, expected and verified hashes/sizes, runtime inventory and completion.
Raw release/HF API responses, upstream installer text, licenses, model card,
and actual `cli-help.txt` are retained alongside it. The archive is kept for
offline inspection. Budget about 5.81 GB of downloads plus extracted runtime.

## Integration

Run `runtime/trellis-cuda/trellis-cli.exe --help` for the pinned binary's flags.
Generation must explicitly pass `--models models/trellis-q4 --res 512`:
the CLI defaults to a 1024 cascade, which is not installed. Setup only runs
`--help`; it does not test GPU inference or memory fit.

The installed v0.6.0 binary's `--help` exits 0. Supported integration flags
include `--image`, `--output`, `--models`, `--gpu 0`, `--require-gpu`, `--res 512`,
`--seed`, `--no-texture`, `--bg-removal`, `--threads`, `--atlas`, `--tex-res`,
`--webp`, and `--no-fa`. Do not pass newer checkout flags `--steps`, `--backend`,
`--fa-fast`, `--fa-f32`, `--sched`, `--model`, or `--verbose`; v0.6.0 does not
implement them. The retained CLI help is authoritative for this installation.

Observed host: RTX 5070 Laptop GPU, compute capability 12.0, driver 610.71,
8,151 MiB VRAM. The selected standard CUDA bundle targets this GPU generation;
actual GPU execution and available memory must be checked by the generation owner.

| Model | Bytes |
| --- | ---: |
| birefnet.gguf | 882,749,024 |
| dinov3.gguf | 172,662,976 |
| ss_flow.gguf | 730,496,672 |
| ss_dec.gguf | 147,379,392 |
| shape_flow_512.gguf | 730,520,576 |
| shape_dec.gguf | 845,423,552 |
| tex_flow_512.gguf | 730,548,224 |
| tex_dec.gguf | 845,414,272 |
| Total models | 5,085,194,688 |

The verified archive is 728,541,568 bytes and its nine extracted runtime files
total 878,218,576 bytes. Retaining the archive uses 6,691,954,832 bytes overall
for models, archive and runtime (plus small metadata). Focused installer tests:
`powershell -NoProfile -File scripts/test-setup-trellis.ps1`.

## Licenses

The engine's MIT license does not relicense its helper models. The HF card
declares `license: other` and is not a complete per-model licensing audit.
[Meta's DINOv3 custom license](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)
applies to converted DINOv3 weights, including use restrictions and a requirement
to accompany redistributions with the agreement. A public mirror is not a
license waiver. Review the retained license before use or redistribution.
Do not substitute gated assets or bypass access controls; setup stops on gated
access and never authenticates. The retained public source is the one specified
by upstream and this setup request, not a replacement for a denied download.
