import datetime as dt
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import openpyxl

from tools.build import build
from tools.excel_a_json import excel_a_raw

FIXTURE = Path(__file__).parent / "fixtures" / "raw_ejemplo.json"


class ExcelTest(unittest.TestCase):
    def test_lee_hojas_y_fechas(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active; ws.title = "Seguimiento"
            ws.append(["WO/LOTE", "ENSAMBLE OCTUBRE"]); ws.append(["1000001L1", dt.datetime(2026, 10, 20)])
            wb.create_sheet("Otra hoja").append(["no se exporta"])
            wb.save(f)
            raw = excel_a_raw(f)
        self.assertEqual(list(raw), ["Seguimiento"])
        self.assertEqual(raw["Seguimiento"][1], ["1000001L1", "2026-10-20"])


class BuildTest(unittest.TestCase):
    def _script(self, html):
        return html.split("<script>")[1].split("</script>")[0]

    def test_build_sin_datos(self):
        with tempfile.TemporaryDirectory() as d:
            out = build(Path(d) / "index.html")
            html = out.read_text(encoding="utf-8")
        self.assertIn("const RAW = {};", html)
        self.assertIn("start();", html)
        for marca in ("function parseWorkbook", "function vBajaj", "function doLogin", "window.claude = {"):
            self.assertIn(marca, html)

    def test_build_con_datos_y_sintaxis(self):
        raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as d:
            out = build(Path(d) / "index.html", raw, "ejemplo.json", "2026-10-13")
            html = out.read_text(encoding="utf-8")
            self.assertIn('"1000001L1"', html)
            node = shutil.which("node")
            if not node:
                self.skipTest("Node.js no está instalado; se omite la verificación de sintaxis")
            js = Path(d) / "app.js"; js.write_text(self._script(html), encoding="utf-8")
            r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
