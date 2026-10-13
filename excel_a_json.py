"""Convierte el Excel de seguimiento en el JSON de hojas que entiende la app.

Uso:
    python tools/excel_a_json.py "ruta/al/archivo.xlsx" [-o data/raw.json]

Se exportan solo las hojas que lee la app: Seguimiento, BD-Faltantes,
Sobrantes Aprov y COLOMBIA. Las fechas quedan como texto AAAA-MM-DD.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import openpyxl

HOJAS = ["Seguimiento", "BD-Faltantes", "Sobrantes Aprov", "COLOMBIA"]


def _norm(nombre: str) -> str:
    return "".join(nombre.upper().split())


def excel_a_raw(ruta: str | Path, hojas: list[str] | None = None) -> dict[str, list[list]]:
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    buscadas = {_norm(h) for h in (hojas or HOJAS)}
    out: dict[str, list[list]] = {}
    for ws in wb.worksheets:
        if _norm(ws.title) not in buscadas:
            continue
        filas = []
        for fila in ws.iter_rows(values_only=True):
            celdas = [v.strftime("%Y-%m-%d") if isinstance(v, (dt.datetime, dt.date)) else v for v in fila]
            while celdas and celdas[-1] is None:
                celdas.pop()
            filas.append(celdas)
        while filas and not filas[-1]:
            filas.pop()
        out[ws.title] = filas
    wb.close()
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("excel")
    p.add_argument("-o", "--salida", default="data/raw.json")
    a = p.parse_args()
    raw = excel_a_raw(a.excel)
    faltan = [h for h in HOJAS if _norm(h) not in {_norm(k) for k in raw}]
    Path(a.salida).parent.mkdir(parents=True, exist_ok=True)
    Path(a.salida).write_text(json.dumps(raw, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{a.salida}: {', '.join(f'{k} ({len(v)} filas)' for k, v in raw.items())}")
    if faltan:
        print("Advertencia: no se encontraron las hojas " + ", ".join(faltan))


if __name__ == "__main__":
    main()
