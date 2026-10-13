"""API REST mínima que reemplaza el almacenamiento compartido de Claude.

Modelo de datos: documentos JSON identificados por una ruta "coleccion/documento"
(se admiten subcolecciones: "a/b/c/d"). Cada escritura incrementa la versión del
documento y el contador de cambios de su colección, que el frontend usa para
detectar cambios por sondeo.
"""
from __future__ import annotations

import getpass
import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file

ROOT = Path(__file__).resolve().parents[1]
SEGMENTO = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,200}$")
MAX_DOC_BYTES = 1_000_000
LOCALES = {"127.0.0.1", "::1", "localhost"}


def _segmentos(path: str, documento: bool) -> list[str]:
    segs = (path or "").strip("/").split("/")
    if not segs or len(segs) > 30 or any(not SEGMENTO.match(s) for s in segs):
        abort(400, "Ruta no válida")
    if (len(segs) % 2 == 0) != documento:
        abort(400, "La ruta de documento debe tener un número par de segmentos y la de colección impar")
    return segs


def create_app(db_path: str | os.PathLike | None = None, dist_dir: str | os.PathLike | None = None) -> Flask:
    app = Flask(__name__)
    db_file = Path(db_path or os.environ.get("UMA_DB") or ROOT / "data" / "app.db")
    db_file.parent.mkdir(parents=True, exist_ok=True)
    dist = Path(dist_dir or os.environ.get("UMA_DIST") or ROOT / "dist")
    lock = threading.Lock()

    def conn() -> sqlite3.Connection:
        c = sqlite3.connect(db_file, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    with conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, coll TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, updated REAL NOT NULL)")
        c.execute("CREATE INDEX IF NOT EXISTS ix_docs_coll ON docs(coll)")
        c.execute("CREATE TABLE IF NOT EXISTS colls (coll TEXT PRIMARY KEY, seq INTEGER NOT NULL)")
        c.execute("PRAGMA journal_mode=WAL")

    def bump(c: sqlite3.Connection, coll: str) -> None:
        c.execute("INSERT INTO colls(coll, seq) VALUES(?, 1) ON CONFLICT(coll) DO UPDATE SET seq = seq + 1", (coll,))

    # ---------- frontend ----------
    @app.get("/")
    @app.get("/index.html")
    def index():
        f = dist / "index.html"
        if not f.exists():
            return Response("No existe dist/index.html. Ejecuta: python tools/build.py", status=503, mimetype="text/plain; charset=utf-8")
        return send_file(f, mimetype="text/html")

    # ---------- API ----------
    @app.get("/api/health")
    def health():
        return jsonify(ok=True, db=str(db_file.name))

    @app.get("/api/me")
    def me():
        local = (request.remote_addr or "") in LOCALES
        nombre = os.environ.get("UMA_NOMBRE") or (getpass.getuser() if local else "")
        return jsonify(
            id=("srv-local" if local else "srv-" + re.sub(r"[^A-Za-z0-9]", "-", request.remote_addr or "remoto")),
            name=nombre, avatarUrl="", color="#E20613",
            # quien abre la app en el mismo equipo del servidor puede crear el administrador inicial
            isOwner=local, canEdit=local,
        )

    @app.get("/api/db/doc")
    def get_doc():
        path = "/".join(_segmentos(request.args.get("path", ""), True))
        with conn() as c:
            row = c.execute("SELECT data, version FROM docs WHERE path = ?", (path,)).fetchone()
        if not row:
            return jsonify(exists=False, version=0)
        return jsonify(exists=True, data=json.loads(row["data"]), version=row["version"])

    @app.put("/api/db/doc")
    def put_doc():
        segs = _segmentos(request.args.get("path", ""), True)
        raw = request.get_data(cache=False)
        if len(raw) > MAX_DOC_BYTES:
            abort(413, "Documento demasiado grande")
        try:
            data = json.loads(raw or b"null")
        except ValueError:
            abort(400, "JSON no válido")
        if not isinstance(data, dict):
            abort(400, "El documento debe ser un objeto JSON")
        path, coll = "/".join(segs), "/".join(segs[:-1])
        texto = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        with lock, conn() as c:
            row = c.execute("SELECT version FROM docs WHERE path = ?", (path,)).fetchone()
            version = (row["version"] if row else 0) + 1
            c.execute("INSERT INTO docs(path, coll, data, version, updated) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data, version=excluded.version, updated=excluded.updated",
                      (path, coll, texto, version, time.time()))
            bump(c, coll)
        return jsonify(ok=True, version=version)

    @app.delete("/api/db/doc")
    def delete_doc():
        segs = _segmentos(request.args.get("path", ""), True)
        path, coll = "/".join(segs), "/".join(segs[:-1])
        with lock, conn() as c:
            cur = c.execute("DELETE FROM docs WHERE path = ?", (path,))
            if cur.rowcount:
                bump(c, coll)
        return jsonify(ok=True)

    @app.get("/api/db/collection")
    def get_collection():
        coll = "/".join(_segmentos(request.args.get("path", ""), False))
        with conn() as c:
            rows = c.execute("SELECT path, data, version FROM docs WHERE coll = ? ORDER BY path", (coll,)).fetchall()
            seq = c.execute("SELECT seq FROM colls WHERE coll = ?", (coll,)).fetchone()
        docs = [{"id": r["path"].rsplit("/", 1)[-1], "data": json.loads(r["data"]), "version": r["version"]} for r in rows]
        return jsonify(docs=docs, etag=(seq["seq"] if seq else 0))

    @app.after_request
    def no_cache(resp):
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    return app
