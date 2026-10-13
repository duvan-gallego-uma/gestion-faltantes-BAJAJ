"""Respaldo y restauración de la base de datos del servidor.

    python tools/respaldo.py exportar respaldo.json [--db data/app.db]
    python tools/respaldo.py importar respaldo.json [--db data/app.db]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def exportar(db: Path, destino: Path) -> int:
    with sqlite3.connect(db) as c:
        filas = c.execute("SELECT path, data, version FROM docs ORDER BY path").fetchall()
    destino.write_text(json.dumps({"exportado": time.time(), "docs": [{"path": p, "data": json.loads(d), "version": v} for p, d, v in filas]}, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(filas)


def importar(db: Path, origen: Path) -> int:
    from server.app import create_app  # crea las tablas si no existen
    create_app(db_path=db)
    docs = json.loads(origen.read_text(encoding="utf-8"))["docs"]
    with sqlite3.connect(db) as c:
        for d in docs:
            coll = d["path"].rsplit("/", 1)[0]
            c.execute("INSERT INTO docs(path, coll, data, version, updated) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data, version=docs.version+1, updated=excluded.updated",
                      (d["path"], coll, json.dumps(d["data"], ensure_ascii=False), d.get("version", 1), time.time()))
            c.execute("INSERT INTO colls(coll, seq) VALUES(?, 1) ON CONFLICT(coll) DO UPDATE SET seq = seq + 1", (coll,))
    return len(docs)


def main() -> None:
    import sys
    sys.path.insert(0, str(ROOT))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("accion", choices=["exportar", "importar"])
    p.add_argument("archivo")
    p.add_argument("--db", default=str(ROOT / "data" / "app.db"))
    a = p.parse_args()
    n = exportar(Path(a.db), Path(a.archivo)) if a.accion == "exportar" else importar(Path(a.db), Path(a.archivo))
    print(f"{a.accion}: {n} documentos")


if __name__ == "__main__":
    main()
