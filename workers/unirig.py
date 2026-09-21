"""Run the upstream extraction, skeleton, skinning and merge stages locally."""
import json
import os
from pathlib import Path
import subprocess
import sys
import struct
from datetime import datetime


def main():
    source, output = [Path(p).resolve() for p in sys.argv[1:3]]
    seed = int(sys.argv[3])
    work = output.parent
    skeleton, skin = work / "skeleton.fbx", work / "skin.fbx"
    npz = work / "extracted"
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", WANDB_MODE="disabled")

    def run(stage, progress, args):
        print("BROOG_EVENT " + json.dumps({"stage": stage, "progress": progress}), flush=True)
        subprocess.run([sys.executable, "-u", *args], check=True)

    def extract(asset, progress):
        run("Extracting mesh", progress, ["-m", "src.data.extract", "--config=configs/data/quick_inference.yaml",
            "--require_suffix=glb,fbx", "--force_override=true", "--num_runs=1", "--id=0", f"--time={datetime.now():%Y_%m_%d_%H_%M_%S}",
            "--faces_target_count=50000", f"--input={asset}", f"--output_dir={npz}"])

    extract(source, 5)
    run("Predicting skeleton", 20, ["run.py", "--task=configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml",
        f"--seed={seed}", f"--input={source}", f"--output={skeleton}", f"--npz_dir={npz}"])
    if not skeleton.exists():
        raise RuntimeError("UniRig did not export the predicted skeleton.")
    extract(skeleton, 55)
    run("Predicting skin weights", 65, ["run.py", "--task=configs/task/quick_inference_unirig_skin.yaml",
        f"--seed={seed}", f"--input={skeleton}", f"--output={skin}", f"--npz_dir={npz}", "--data_name=raw_data.npz"])
    if not skin.exists():
        raise RuntimeError("UniRig did not export skin weights.")
    run("Merging rig and materials", 90, ["-m", "src.inference.merge", "--require_suffix=glb,fbx",
        "--num_runs=1", "--id=0", f"--source={skin}", f"--target={source}", f"--output={output}"])
    if not output.exists():
        raise RuntimeError("UniRig did not export a rigged GLB.")
    with output.open("rb") as asset:
        header = asset.read(20)
        if len(header) != 20 or header[:4] != b"glTF":
            raise RuntimeError("UniRig returned an invalid GLB.")
        size = struct.unpack_from("<I", header, 12)[0]
        if size > 16 * 1024 * 1024:
            raise RuntimeError("Unexpectedly large GLB metadata.")
        metadata = json.loads(asset.read(size))
    weighted = any("JOINTS_0" in p.get("attributes", {}) and "WEIGHTS_0" in p.get("attributes", {})
                   for mesh in metadata.get("meshes", []) for p in mesh.get("primitives", []))
    if not metadata.get("skins") or not weighted:
        raise RuntimeError("Export contains no skin weights; it is not a rigged asset.")
    print('BROOG_EVENT {"stage":"Ready","progress":100}', flush=True)


if __name__ == "__main__":
    main()
