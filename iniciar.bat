@echo off
REM Inicia la app en Windows: crea el entorno la primera vez, construye y abre el servidor.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
  call .venv\Scripts\activate.bat
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)
python tools\build.py
start "" http://127.0.0.1:8000
python -m server --port 8000
