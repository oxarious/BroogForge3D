import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
import struct
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "workers/unirig.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_pipeline_uses_separate_arguments_and_checks_outputs(self):
        with tempfile.TemporaryDirectory(prefix="broog rig ") as folder:
            source = Path(folder) / "source.glb"
            output = Path(folder) / "model.glb"
            calls = []

            def run(args, check):
                calls.append(args)
                self.assertTrue(check)
                for arg in args:
                    if arg.startswith("--output="):
                        file = Path(arg.split("=", 1)[1])
                        data = json.dumps({"skins":[{"joints":[0]}],"meshes":[{"primitives":[{"attributes":{"JOINTS_0":0,"WEIGHTS_0":1}}]}]}).encode()
                        file.write_bytes(b"glTF" + struct.pack("<IIII", 2, 20 + len(data), len(data), 0x4E4F534A) + data if file.suffix == '.glb' else b"test output")

            with patch.object(worker.sys, "argv", ["unirig.py", str(source), str(output), "42"]), patch.object(worker.subprocess, "run", run):
                worker.main()
            self.assertEqual(len(calls), 5)
            self.assertTrue(any(arg.startswith("--time=") for arg in calls[0]))
            self.assertIn(f"--input={source}", calls[0])
            self.assertTrue(output.exists())

    def test_missing_skeleton_stops_skinning(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(worker.sys, "argv", ["unirig.py", str(Path(folder)/"source.glb"), str(Path(folder)/"model.glb"), "42"]), patch.object(worker.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "skeleton"):
                    worker.main()
                self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
