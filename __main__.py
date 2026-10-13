"""Ejecuta el servidor:  python -m server [--host 0.0.0.0] [--port 8000]"""
import argparse

from .app import create_app


def main() -> None:
    p = argparse.ArgumentParser(description="Servidor de Gestión de Lotes (Grupo UMA)")
    p.add_argument("--host", default="127.0.0.1", help="Usa 0.0.0.0 para acceso desde otros equipos de la red")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--db", default=None, help="Ruta del archivo SQLite (por defecto data/app.db)")
    a = p.parse_args()
    app = create_app(db_path=a.db)
    print(f"Gestión de Lotes en http://{a.host}:{a.port}  (Ctrl+C para detener)")
    app.run(host=a.host, port=a.port, threaded=True)


if __name__ == "__main__":
    main()
