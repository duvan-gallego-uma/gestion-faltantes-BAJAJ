"""Pruebas del motor de compensación (frontend/src/core.js) ejecutado con Node.js."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "frontend" / "src" / "core.js"
FIXTURE = Path(__file__).parent / "fixtures" / "raw_ejemplo.json"

SCRIPT = """
const C = require(process.argv[1]);
const raw = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const base = C.parseWorkbook(raw);
const fuentes = C.SOURCES.map(s => ({ id: s.id, on: true }));
const r = C.compute(base, {}, fuentes);
const out = { lots: Object.keys(base.lots).length, lines: base.lines.length, sob: base.sobrantes.length, warnings: base.warnings,
  status: Object.fromEntries(r.ordered.map(l => [l.key, l.status])),
  l1: r.lots['1000001L1'].lines.map(x => ({ sku: x.sku, pend: x.pend, prop: x.proposal, gap: x.gap })),
  kpi: r.kpi };
const r2 = C.compute(base, { comp: { '1000001L1': { ingresos: [{ id: 'i', lineId: '1000001L1|DEMO0002', sku: 'DEMO0002', qty: 5, src: 'BUFFER' }] } } }, fuentes);
out.trasIngreso = { pend: r2.lots['1000001L1'].lines.find(x => x.sku === 'DEMO0002').pend, avance: r2.lots['1000001L1'].avance };
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "Node.js no está instalado")
class MotorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run(["node", "-e", SCRIPT, str(CORE), str(FIXTURE)], capture_output=True, text=True, check=True)
        cls.r = json.loads(p.stdout)

    def test_lectura(self):
        self.assertEqual(self.r["lots"], 3)
        self.assertEqual(self.r["lines"], 4)
        self.assertEqual(self.r["sob"], 1)
        self.assertEqual(self.r["warnings"], [])

    def test_estados(self):
        s = self.r["status"]
        # DEMO0001 necesita 10: 2 sobrante de lote + 4 mezzanine + 3 CEDI = 9 → falta 1 → CRÍTICO
        self.assertEqual(s["1000001L1"], "CRÍTICO")
        self.assertEqual(s["1000001L2"], "COMPLETABLE")
        # ensamblado con faltante pendiente: sigue activo (motos incompletas) y se completa con mezzanine
        self.assertEqual(s["1000002L1"], "COMPLETABLE")

    def test_reparto_sin_doble_conteo(self):
        d1 = next(x for x in self.r["l1"] if x["sku"] == "DEMO0001")
        self.assertEqual(sum(p["qty"] for p in d1["prop"]), 9)
        self.assertEqual(d1["gap"], 1)
        self.assertEqual(d1["prop"][0]["src"], "LOTES")

    def test_ingreso_reduce_pendiente(self):
        self.assertEqual(self.r["trasIngreso"]["pend"], 0)
        self.assertGreater(self.r["trasIngreso"]["avance"], 0)


if __name__ == "__main__":
    unittest.main()
