import json
import tempfile
import unittest
from pathlib import Path

from server.app import create_app


class ServidorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "dist").mkdir()
        (d / "dist" / "index.html").write_text("<html>ok</html>", encoding="utf-8")
        self.c = create_app(db_path=d / "t.db", dist_dir=d / "dist").test_client()

    def tearDown(self):
        self.tmp.cleanup()

    def test_index_y_salud(self):
        with self.c.get("/") as r:
            self.assertIn(b"ok", r.data)
        self.assertTrue(self.c.get("/api/health").json["ok"])

    def test_documento_crud_y_version(self):
        u = "/api/db/doc?path=verif/1000001L1"
        self.assertFalse(self.c.get(u).json["exists"])
        self.assertEqual(self.c.put(u, json={"status": "EN CURSO"}).json["version"], 1)
        self.assertEqual(self.c.put(u, json={"status": "VERIFICADO"}).json["version"], 2)
        r = self.c.get(u).json
        self.assertTrue(r["exists"]); self.assertEqual(r["data"]["status"], "VERIFICADO")
        self.c.delete(u)
        self.assertFalse(self.c.get(u).json["exists"])

    def test_coleccion_y_etag(self):
        e0 = self.c.get("/api/db/collection?path=cuentas").json["etag"]
        self.c.put("/api/db/doc?path=cuentas/ana", json={"nombre": "Ana"})
        self.c.put("/api/db/doc?path=cuentas/luis", json={"nombre": "Luis"})
        r = self.c.get("/api/db/collection?path=cuentas").json
        self.assertEqual([d["id"] for d in r["docs"]], ["ana", "luis"])
        self.assertGreater(r["etag"], e0)
        self.c.delete("/api/db/doc?path=cuentas/ana")
        r2 = self.c.get("/api/db/collection?path=cuentas").json
        self.assertEqual(len(r2["docs"]), 1); self.assertGreater(r2["etag"], r["etag"])

    def test_validaciones(self):
        self.assertEqual(self.c.get("/api/db/doc?path=solo").status_code, 400)
        self.assertEqual(self.c.get("/api/db/collection?path=a/b").status_code, 400)
        self.assertEqual(self.c.put("/api/db/doc?path=a/b", data="[1]", content_type="application/json").status_code, 400)
        self.assertEqual(self.c.put("/api/db/doc?path=a/b", data=json.dumps({"x": "y" * 1_100_000}), content_type="application/json").status_code, 413)
        self.assertEqual(self.c.get("/api/db/doc?path=a/b%20c").status_code, 400)

    def test_me_local_es_propietario(self):
        r = self.c.get("/api/me", environ_base={"REMOTE_ADDR": "127.0.0.1"}).json
        self.assertTrue(r["isOwner"])
        r = self.c.get("/api/me", environ_base={"REMOTE_ADDR": "10.0.0.5"}).json
        self.assertFalse(r["isOwner"])


if __name__ == "__main__":
    unittest.main()
