"""Offline readiness check. Execute using runtime/unirig-env/Scripts/python.exe."""
import importlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HOME=str(root / "models/unirig-cache"))
sys.path.insert(0, str(root / "vendor/UniRig"))
errors = []
for name in ["torch", "bpy", "flash_attn", "spconv.pytorch", "torch_scatter", "torch_cluster", "transformers", "lightning", "omegaconf", "trimesh", "open3d", "pyrender", "psutil", "src.model.unirig_skin"]:
    try:
        module = importlib.import_module(name)
        if name == "torch" and not module.cuda.is_available():
            errors.append("CUDA PyTorch unavailable")
    except Exception as error:
        errors.append(f"{name}: {str(error)[:150]}")
try:
    from huggingface_hub import hf_hub_download
    for filename in ["skeleton/articulation-xl_quantization_256/model.ckpt", "skin/articulation-xl/model.ckpt"]:
        hf_hub_download("VAST-AI/UniRig", filename, local_files_only=True)
    from transformers import AutoConfig
    AutoConfig.from_pretrained("facebook/opt-350m", local_files_only=True)
except Exception as error:
    errors.append(f"Offline model cache: {str(error)[:150]}")
report = {"ready": not errors, "checkedAt": datetime.now(timezone.utc).isoformat(), "errors": errors,
          "reason": "Preflight passed" if not errors else "UniRig unavailable: " + "; ".join(errors[:4])}
(root / "runtime/unirig-health.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
sys.exit(1 if errors else 0)
