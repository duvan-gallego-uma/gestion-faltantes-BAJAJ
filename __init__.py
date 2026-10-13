"""Servidor de la app Gestión de Lotes: sirve el frontend y guarda los datos en SQLite."""
from .app import create_app

__all__ = ["create_app"]
