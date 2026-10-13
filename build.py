"""Construye dist/index.html: un solo archivo con estilos, código y (opcional) datos.

Uso:
    python tools/build.py                         # sin datos embebidos (se cargan en Datos)
    python tools/build.py --excel "archivo.xlsx"  # embebe los datos del Excel
    python tools/build.py --raw data/raw.json     # embebe un JSON generado por excel_a_json.py

El archivo resultante funciona de tres formas: servido por `python -m server`
(datos compartidos en SQLite), publicado como artifact en Claude, o abierto
directamente en el navegador (modo local, sin compartir).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
MODULOS = ["runtime.js", "core.js", "app.js", "fuentes.js", "usuarios.js", "bajaj.js"]


def build(salida: Path | str = ROOT / "dist" / "index.html", raw: dict | None = None, archivo: str = "", corte: str = "") -> Path:
    plantilla = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    js = "\n".join(f"/* ---- {m} ---- */\n" + (SRC / m).read_text(encoding="utf-8") for m in MODULOS) + "\nstart();\n"
    datos = json.dumps(raw or {}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    bloque = f"const RAW = {datos};\nconst EMBED_FILE = {json.dumps(archivo)};\nconst EMBED_AT = {json.dumps(corte)};"
    for marca in ("/*__CSS__*/", "/*__DATA__*/", "/*__JS__*/"):
        if marca not in plantilla:
            raise ValueError(f"La plantilla no tiene la marca {marca}")
    html = plantilla.replace("/*__CSS__*/", css).replace("/*__DATA__*/", bloque).replace("/*__JS__*/", js.replace("</script", "<\\/script"))
    salida = Path(salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(html, encoding="utf-8")
    return salida


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--excel", help="Excel de seguimiento para embeber sus datos")
    g.add_argument("--raw", help="JSON de hojas (salida de tools/excel_a_json.py)")
    p.add_argument("-o", "--salida", default=str(ROOT / "dist" / "index.html"))
    p.add_argument("--corte", default=dt.date.today().isoformat(), help="Fecha de corte que se muestra (AAAA-MM-DD)")
    a = p.parse_args()
    raw, archivo = None, ""
    if a.excel:
        sys.path.insert(0, str(ROOT))
        from tools.excel_a_json import excel_a_raw
        raw, archivo = excel_a_raw(a.excel), Path(a.excel).name
    elif a.raw:
        raw, archivo = json.loads(Path(a.raw).read_text(encoding="utf-8")), Path(a.raw).name
    out = build(a.salida, raw, archivo, a.corte if raw else "")
    print(f"Listo: {out} ({out.stat().st_size / 1024:.0f} KB){' con datos de ' + archivo if archivo else ' sin datos embebidos'}")


if __name__ == "__main__":
    main()
