#!/usr/bin/env bash
# Inicia la app en Linux/macOS: crea el entorno la primera vez, construye y abre el servidor.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  . .venv/bin/activate
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi
python tools/build.py
python -m server --port 8000
