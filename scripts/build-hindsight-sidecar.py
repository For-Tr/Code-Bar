#!/usr/bin/env python3
"""Build the Hindsight sidecar used by Code Bar release bundles.

Requires Python 3.12, uv, and PyInstaller. The resulting executable is copied to
src-tauri/resources/hindsight/<platform>/hindsight-api; CI should run this once
per target architecture before `tauri build`.
"""
from pathlib import Path
import os, platform, shutil, subprocess, sys

root = Path(__file__).resolve().parents[1]
out = root / "src-tauri" / "resources" / "hindsight"
name = "hindsight-api.exe" if os.name == "nt" else "hindsight-api"
venv = Path(os.environ.get("CODEBAR_HINDSIGHT_BUILD_ENV", "/tmp/codebar-hindsight-build-env"))
python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.exists():
    subprocess.check_call(["uv", "venv", "--python", "3.12", str(venv)])
subprocess.check_call(["uv", "pip", "install", "--python", str(python), "hindsight-api-slim[embedded-db,local-onnx]==0.10.0", "pyinstaller", "huggingface-hub"])
model_dir = out / "models" / "multilingual-e5-small"
model_dir.mkdir(parents=True, exist_ok=True)
model_script = "from huggingface_hub import snapshot_download\nimport os\nsnapshot_download(repo_id='intfloat/multilingual-e5-small', local_dir=os.environ['CODEBAR_HINDSIGHT_MODEL_DIR'], allow_patterns=['onnx/model_O4.onnx', 'onnx/config.json', 'onnx/tokenizer*', 'onnx/special_tokens_map.json', '*.json', 'tokenizer*', 'special_tokens_map.json', 'spiece.model', 'sentencepiece.bpe.model', 'vocab.txt'])\n"
model_helper = root / "scripts" / ".download_hindsight_model.py"
model_helper.write_text(model_script, encoding="utf-8")
try:
    env = os.environ.copy(); env["CODEBAR_HINDSIGHT_MODEL_DIR"] = str(model_dir)
    env.setdefault("HF_ENDPOINT", "https://huggingface.co")
    subprocess.check_call([str(python), str(model_helper)], env=env)
finally:
    model_helper.unlink(missing_ok=True)
wrapper = root / "scripts" / ".hindsight_entry.py"
wrapper.write_text("from hindsight_api.main import main\nif __name__ == '__main__': main()\n", encoding="utf-8")
try:
    subprocess.check_call([
        str(python), "-m", "PyInstaller", "--onefile", "--name", "hindsight-api",
        "--collect-all", "hindsight_api",
        "--collect-all", "onnxruntime",
        "--collect-all", "transformers",
        "--collect-all", "tokenizers",
        "--hidden-import", "onnxruntime",
        "--hidden-import", "transformers",
        str(wrapper),
    ])
finally:
    wrapper.unlink(missing_ok=True)
artifact = root / "dist" / name
if not artifact.exists():
    raise SystemExit(f"PyInstaller did not produce {artifact}")
out.mkdir(parents=True, exist_ok=True)
shutil.copy2(artifact, out / name)
if os.name != "nt":
    (out / name).chmod(0o755)
print(f"built {out / name} for {platform.machine()}")
