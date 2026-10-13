/* ===== Núcleo: lectura del Excel y motor de compensación ===== */
const U = {
  str: v => (v == null ? '' : String(v).trim()),
  up: v => (v == null ? '' : String(v).trim().toUpperCase()),
  sku: v => (v == null ? '' : String(v).trim().toUpperCase().replace(/\s+/g, '')),
  key: v => (v == null ? '' : String(v).trim().toUpperCase().replace(/\s+/g, '')),
  num: v => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = Number(String(v).replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
  },
  date: v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null),
};

const SOURCES = [
  { id: 'LOTES', label: 'Sobrantes de lotes' },
  { id: 'REPO', label: 'Reposición Bajaj recibida' },
  { id: 'MEZZ', label: 'Sobrantes mezzanine' },
  { id: 'CKD', label: 'Sobrantes CKD' },
  { id: 'BUFFER', label: 'Buffer' },
  { id: 'CARRUSEL', label: 'Carrusel' },
  { id: 'HOMOLOGAS', label: 'Homólogas' },
  { id: 'CEDI', label: 'CEDI' },
  { id: 'CA', label: 'Centro América' },
];
const SRC_LABEL = Object.fromEntries(SOURCES.map(s => [s.id, s.label]));
const INV_KEYS = ['MEZZ', 'CKD', 'BUFFER', 'CARRUSEL', 'HOMOLOGAS', 'CEDI', 'CA'];

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
function mesStart(mes) {
  const m = U.up(mes).match(/([A-ZÁÉÍÓÚ]+)\s*(\d{4})/);
  if (!m) return null;
  const i = MESES.indexOf(m[1]);
  if (i < 0) return null;
  return `${m[2]}-${String(i + 1).padStart(2, '0')}-01`;
}

function findRow(rows, pred, max = 20) {
  for (let i = 0; i < Math.min(rows.length, max); i++) if (pred(rows[i] || [])) return i;
  return -1;
}
function col(hdr, test) {
  return hdr.findIndex(h => h != null && test(U.up(h)));
}
function sheetByName(raw, ...names) {
  const keys = Object.keys(raw);
  for (const n of names) {
    const k = keys.find(k => U.up(k).replace(/\s+/g, '') === U.up(n).replace(/\s+/g, ''));
    if (k) return raw[k];
  }
  return null;
}

/* raw: { nombreHoja: [[celdas]] } con fechas como 'YYYY-MM-DD' */
function parseWorkbook(raw) {
  const warnings = [];
  const lots = {};
  const lines = [];
  const sobrantes = [];
  const inventario = {};
  const reposicion = {};
  const inv = sku => (inventario[sku] = inventario[sku] || { MEZZ: 0, CKD: 0, BUFFER: 0, CARRUSEL: 0, HOMOLOGAS: 0, CEDI: 0, CA: 0, _bd: false });

  /* --- Seguimiento --- */
  const seg = sheetByName(raw, 'Seguimiento');
  if (!seg) warnings.push('No se encontró la hoja «Seguimiento».');
  else {
    const h = findRow(seg, r => r.some(c => U.up(c) === 'WO/LOTE'));
    if (h < 0) warnings.push('«Seguimiento»: no se encontró el encabezado WO/LOTE.');
    else {
      const H = seg[h];
      const c = {
        modelo: col(H, x => x === 'MODELO'), wo: col(H, x => x === 'WO'), lote: col(H, x => x === 'LOTE'),
        key: col(H, x => x === 'WO/LOTE'), ubic: col(H, x => x.startsWith('UBICACI')),
        estado: col(H, x => x === 'ESTADO CKD'), mes: col(H, x => x === 'MES ENSAMBLE'),
        prog: col(H, x => /^ENSAMBLE\s/.test(x)), rev: col(H, x => x.startsWith('FECHA REVISI')),
        nota: col(H, x => x === 'ESTADO FALTANTES'),
      };
      for (let i = h + 1; i < seg.length; i++) {
        const r = seg[i] || [];
        const key = U.key(r[c.key]);
        if (!key) continue;
        const progRaw = c.prog >= 0 ? r[c.prog] : null;
        lots[key] = {
          key, wo: U.str(r[c.wo]), lote: U.up(r[c.lote]), modelo: U.str(r[c.modelo]),
          ubic: U.str(r[c.ubic]), estadoCKD: U.up(r[c.estado]), mes: U.up(r[c.mes]),
          fechaProg: U.date(progRaw), progTxt: U.date(progRaw) ? '' : U.up(progRaw),
          fechaRev: U.date(r[c.rev]), nota: c.nota >= 0 ? U.str(r[c.nota]) : '', enSeguimiento: true,
        };
      }
    }
  }

  /* --- BD-Faltantes --- */
  const bd = sheetByName(raw, 'BD-Faltantes', 'BD Faltantes');
  if (!bd) warnings.push('No se encontró la hoja «BD-Faltantes».');
  else {
    const h = findRow(bd, r => r.some(c => U.up(c) === 'SKU') && r.some(c => U.up(c) === 'WO/LOTE'));
    if (h < 0) warnings.push('«BD-Faltantes»: no se encontró el encabezado.');
    else {
      const H = bd[h];
      const c = {
        wo: col(H, x => x === 'WO'), lote: col(H, x => x === 'LOTE'), key: col(H, x => x === 'WO/LOTE'),
        mes: col(H, x => x === 'MES ENSAMBLE'), pcc: col(H, x => x.startsWith('PCC')), modelo: col(H, x => x === 'MODELO'),
        sku: col(H, x => x === 'SKU'), notif: col(H, x => x === 'NOTIFICADO'), falt: col(H, x => x.includes('FALTARON')),
        rep: col(H, x => x.startsWith('CANT. REPORTADA')), mezz: col(H, x => x.includes('MEZZAN')),
        ckd: col(H, x => x.startsWith('INV. SOBRANTES CKD')), buf: col(H, x => x === 'INV. BUFFER'),
        ing: col(H, x => x.startsWith('CANT. INGRESADA')), pend: col(H, x => x.startsWith('CANT. PENDIENTE')),
        skuSol: col(H, x => x === 'SKU SOLUCIONABLE'), loteSol: col(H, x => x === 'LOTE SOLUCIONABLE'),
      };
      const seen = {};
      for (let i = h + 1; i < bd.length; i++) {
        const r = bd[i] || [];
        const key = U.key(r[c.key]) || (U.key(r[c.wo]) + U.key(r[c.lote]));
        const sku = U.sku(r[c.sku]);
        if (!key || !sku) continue;
        if (!lots[key]) {
          const p = c.pcc >= 0 ? r[c.pcc] : null;
          lots[key] = {
            key, wo: U.str(r[c.wo]), lote: U.up(r[c.lote]), modelo: U.str(r[c.modelo]), ubic: '', estadoCKD: '',
            mes: U.up(r[c.mes]), fechaProg: U.date(p), progTxt: U.date(p) ? '' : U.up(p), fechaRev: null, nota: '', enSeguimiento: false,
          };
        }
        if (!lots[key].modelo) lots[key].modelo = U.str(r[c.modelo]);
        let id = key + '|' + sku;
        seen[id] = (seen[id] || 0) + 1;
        if (seen[id] > 1) id += '#' + seen[id];
        lines.push({
          id, key, sku, modelo: U.str(r[c.modelo]), notificado: U.up(r[c.notif]) === 'SI',
          hallazgo: U.up(r[c.falt]), reportada: U.num(r[c.rep]), ingresada: U.num(r[c.ing]),
          pendXls: U.num(r[c.pend]), skuSolXls: U.up(r[c.skuSol]), loteSolXls: U.up(r[c.loteSol]),
        });
        const it = inv(sku);
        if (!it._bd) {
          it.MEZZ = U.num(r[c.mezz]); it.CKD = U.num(r[c.ckd]); it.BUFFER = U.num(r[c.buf]); it._bd = true;
        }
      }
    }
  }

  /* --- Sobrantes Aprov --- */
  const sa = sheetByName(raw, 'Sobrantes Aprov', 'Sobrantes');
  if (!sa) warnings.push('No se encontró la hoja «Sobrantes Aprov».');
  else {
    const h = findRow(sa, r => r.some(c => U.up(c) === 'QTY'));
    if (h < 0) warnings.push('«Sobrantes Aprov»: no se encontró el encabezado.');
    else {
      const H = sa[h].map(U.up);
      // bloque derecho: sku | QTY | NOTIFICADO | W/O
      let rs = -1, ls = -1;
      for (let j = 0; j < H.length; j++) {
        if (H[j] === 'SKU' && H[j + 1] === 'QTY') {
          if ((H[j + 3] || '').replace(/\s/g, '') === 'W/O') rs = j; else if (ls < 0) ls = j;
        }
      }
      if (rs < 0) warnings.push('«Sobrantes Aprov»: no se encontró el bloque SOBRANTES (sku, QTY, NOTIFICADO, W/O).');
      const cc = {
        cedi: H.indexOf('CEDI'), ca: H.indexOf('CENTRO AMERICA'), hom: H.indexOf('HOMOLOGAS'), car: H.indexOf('CARRUSEL'),
        buf: H.indexOf('BUFFER'), mezz: H.findIndex(x => x.includes('MEZZANINE')),
      };
      let n = 0;
      for (let i = h + 1; i < sa.length; i++) {
        const r = sa[i] || [];
        if (rs >= 0) {
          const sku = U.sku(r[rs]), key = U.key(r[rs + 3]), qty = U.num(r[rs + 1]);
          if (sku && key && qty > 0) {
            sobrantes.push({ id: 'S' + (++n) + ':' + key + '|' + sku, key, sku, qty, notificado: U.up(r[rs + 2]) === 'SI' });
            if (!lots[key]) lots[key] = { key, wo: key.replace(/L\d+$/, ''), lote: (key.match(/L\d+$/) || [''])[0], modelo: '', ubic: '', estadoCKD: '', mes: '', fechaProg: null, progTxt: '', fechaRev: null, nota: '', enSeguimiento: false };
          }
        }
        if (ls >= 0) {
          const sku = U.sku(r[ls]);
          if (sku) {
            const it = inv(sku);
            if (cc.cedi >= 0) it.CEDI = Math.max(it.CEDI, U.num(r[cc.cedi]));
            if (cc.ca >= 0) it.CA = Math.max(it.CA, U.num(r[cc.ca]));
            if (cc.hom >= 0) it.HOMOLOGAS = Math.max(it.HOMOLOGAS, U.num(r[cc.hom]));
            if (cc.car >= 0) it.CARRUSEL = Math.max(it.CARRUSEL, U.num(r[cc.car]));
            if (!it._bd) {
              if (cc.buf >= 0) it.BUFFER = Math.max(it.BUFFER, U.num(r[cc.buf]));
              if (cc.mezz >= 0) it.MEZZ = Math.max(it.MEZZ, U.num(r[cc.mezz]));
            }
          }
        }
      }
    }
  }

  /* --- COLOMBIA: reposición anunciada por Bajaj --- */
  const co = sheetByName(raw, 'COLOMBIA');
  if (co) {
    let c0 = -1, fecha = null;
    for (const r0 of co) {
      const r = r0 || [];
      const hc = r.findIndex(x => U.up(x).startsWith('SKU CON FALTANTE'));
      if (hc >= 0) { c0 = hc; fecha = null; continue; }
      if (c0 < 0) continue;
      const sku = U.sku(r[c0]);
      const wo = U.str(r[c0 + 2]);
      if (U.date(r[c0 + 1])) fecha = U.date(r[c0 + 1]);
      if (!sku || !wo || !/^\d+$/.test(wo)) continue;
      (reposicion[sku] = reposicion[sku] || []).push({ wo, modelo: U.str(r[c0 + 4]), caja: U.str(r[c0 + 5]), fecha });
    }
  }

  for (const k in inventario) delete inventario[k]._bd;
  return { lots, lines, sobrantes, inventario, reposicion, warnings };
}

/* ===== Motor =====
   base: resultado de parseWorkbook
   st: { verif: {key: {status, by, at, lines:{lineId:{qty,motivo,obs,by,at}}, extras:[...]}},
         comp:  {key: {approvals:[{id,lineId,sku,src,ref,qty,by,at,cerrada}]}} }
   fuentes: [{id, on}] en orden de prioridad */
function isEnsamblado(l) { return /ENSAMBLAD/.test(l.estadoCKD || ''); }
function prioKey(l) {
  if (l.fechaProg) return l.fechaProg + '-0';
  const m = mesStart(l.mes);
  if (m) return m.slice(0, 7) + '-31-1';
  return '9999-12-31-2';
}

function compute(base, st, fuentes) {
  const verif = st.verif || {}, comp = st.comp || {};
  const order = fuentes.filter(f => f.on).map(f => f.id);
  const lots = {};
  for (const k in base.lots) lots[k] = { ...base.lots[k], lines: [], sob: [], ens: isEnsamblado(base.lots[k]), prio: prioKey(base.lots[k]) };

  /* ingresos registrados (unidades completadas físicamente) */
  const ingByLine = {}, ingresosAll = [];
  for (const key in comp) for (const i of comp[key].ingresos || []) {
    ingresosAll.push({ ...i, key });
    if (i.cerrada) continue;
    (ingByLine[i.lineId] = ingByLine[i.lineId] || []).push(i);
  }
  const ingQty = id => (ingByLine[id] || []).reduce((t, i) => t + U.num(i.qty), 0);

  /* líneas efectivas */
  const allLines = [];
  for (const b of base.lines) {
    const v = verif[b.key]?.lines?.[b.id];
    const verified = v && v.qty != null && v.qty !== '' ? U.num(v.qty) : null;
    const real = verified != null ? verified : (b.hallazgo === 'NO FALTARON' ? 0 : b.reportada);
    const provisional = verified == null && b.hallazgo !== 'SI' && b.hallazgo !== 'NO FALTARON';
    const completado = ingQty(b.id);
    allLines.push({ ...b, verified, vinfo: v || null, real, provisional, extra: false, completado, ingresos: ingByLine[b.id] || [], pend: Math.max(0, real - b.ingresada - completado) });
  }
  const supplyLots = base.sobrantes.map(s => ({ ...s, extra: false }));
  for (const key in verif) {
    for (const e of verif[key].extras || []) {
      const sku = U.sku(e.sku), q = U.num(e.qty);
      if (!sku || q <= 0) continue;
      if (e.tipo === 'SOBRANTE') supplyLots.push({ id: 'X:' + e.id, key, sku, qty: q, notificado: false, extra: true });
      else allLines.push({
        id: 'X:' + e.id, key, sku, modelo: lots[key]?.modelo || '', notificado: false, hallazgo: 'VERIFICACIÓN',
        reportada: 0, ingresada: 0, pendXls: 0, skuSolXls: '', loteSolXls: '', verified: q, vinfo: e, real: q,
        provisional: false, extra: true, completado: ingQty('X:' + e.id), ingresos: ingByLine['X:' + e.id] || [], pend: Math.max(0, q - ingQty('X:' + e.id)),
      });
    }
  }

  /* oferta por SKU */
  const supply = {};
  const sup = (sku) => (supply[sku] = supply[sku] || {});
  for (const s of supplyLots) {
    const m = sup(s.sku);
    const k = 'LOTES|' + s.key;
    m[k] = m[k] || { src: 'LOTES', ref: s.key, ini: 0, left: 0 };
    m[k].ini += s.qty; m[k].left += s.qty;
    lots[s.key] && lots[s.key].sob.push(s);
  }
  for (const sku in (st.repoRec || {})) { const q = U.num(st.repoRec[sku]); if (q > 0) sup(sku)['REPO|'] = { src: 'REPO', ref: '', ini: q, left: q }; }
  for (const sku in base.inventario) {
    const it = base.inventario[sku], m = sup(sku);
    for (const id of INV_KEYS) if (it[id] > 0) m[id + '|'] = { src: id, ref: '', ini: it[id], left: it[id] };
  }

  /* aprobaciones abiertas consumen oferta */
  const byLine = {};
  const approvalsAll = [];
  for (const key in comp) for (const a of comp[key].approvals || []) {
    approvalsAll.push({ ...a, key });
    if (a.cerrada) continue;
    (byLine[a.lineId] = byLine[a.lineId] || []).push(a);
    const m = sup(a.sku), k = a.src + '|' + (a.ref || '');
    m[k] = m[k] || { src: a.src, ref: a.ref || '', ini: 0, left: 0 };
    m[k].left -= U.num(a.qty);
  }

  for (const id in ingByLine) for (const i of ingByLine[id]) {
    if (!SRC_LABEL[i.src]) continue;
    const m = sup(i.sku), k = i.src + '|' + (i.ref || '');
    m[k] = m[k] || { src: i.src, ref: i.ref || '', ini: 0, left: 0 };
    m[k].left -= U.num(i.qty);
  }

  for (const ln of allLines) {
    const ap = byLine[ln.id] || [];
    ln.approved = ap.reduce((s, a) => s + U.num(a.qty), 0);
    ln.approvals = ap;
    ln.need = Math.max(0, ln.pend - ln.approved);
    ln.proposal = [];
    ln.gap = 0;
    if (lots[ln.key]) lots[ln.key].lines.push(ln);
    else lots[ln.key] = { key: ln.key, wo: '', lote: '', modelo: ln.modelo, ubic: '', estadoCKD: '', mes: '', fechaProg: null, progTxt: '', lines: [ln], sob: [], ens: false, prio: '9999' };
  }

  /* un lote ensamblado con faltantes pendientes sigue activo: motos incompletas */
  for (const k in lots) {
    const lot = lots[k];
    lot.ensamblado = lot.ens;
    lot.motosInc = lot.ens && lot.lines.some(l => l.pend > 0);
    if (lot.motosInc) lot.ens = false;
  }

  /* asignación por prioridad de fecha */
  const ordered = Object.values(lots).sort((a, b) => (a.prio < b.prio ? -1 : a.prio > b.prio ? 1 : a.key < b.key ? -1 : 1));
  const rank = (e) => { const i = order.indexOf(e.src); return i < 0 ? 999 : i; };
  for (const lot of ordered) {
    if (lot.ens) continue;
    for (const ln of lot.lines) {
      let need = ln.need;
      if (need <= 0) continue;
      const entries = Object.values(supply[ln.sku] || {}).filter(e => order.includes(e.src) && e.left > 0).sort((a, b) => rank(a) - rank(b) || (a.ref === lot.key ? -1 : 0));
      for (const e of entries) {
        if (need <= 0) break;
        const q = Math.min(need, e.left);
        e.left -= q; need -= q;
        ln.proposal.push({ src: e.src, ref: e.ref, qty: q });
      }
      ln.gap = need;
    }
  }

  /* resumen por lote */
  for (const lot of ordered) {
    const L = lot.lines;
    lot.nLines = L.length;
    lot.nFalt = L.filter(l => l.pend > 0).length;
    lot.pend = L.reduce((s, l) => s + l.pend, 0);
    lot.approved = L.reduce((s, l) => s + Math.min(l.approved, l.pend), 0);
    lot.proposed = L.reduce((s, l) => s + l.proposal.reduce((t, p) => t + p.qty, 0), 0);
    lot.gap = L.reduce((s, l) => s + l.gap, 0);
    lot.need = L.reduce((s, l) => s + l.need, 0);
    lot.provisional = L.some(l => l.provisional && l.pend > 0);
    lot.realTot = L.reduce((s, l) => s + l.real, 0);
    lot.done = L.reduce((s, l) => s + Math.min(l.real, l.ingresada + l.completado), 0);
    lot.completado = L.reduce((s, l) => s + l.completado, 0);
    lot.avance = lot.realTot > 0 ? lot.done / lot.realTot : 1;
    lot.cov = lot.realTot > 0 ? Math.min(1, (lot.done + lot.approved + lot.proposed) / lot.realTot) : 1;
    lot.nCrit = L.filter(l => l.gap > 0).length;
    if (lot.ens) lot.status = 'ENSAMBLADO';
    else if (!L.length) lot.status = 'SIN NOVEDAD';
    else if (lot.pend === 0) lot.status = 'COMPLETO';
    else if (lot.gap === 0) lot.status = 'COMPLETABLE';
    else lot.status = 'CRÍTICO';
    const v = verif[lot.key];
    lot.verif = lot.ens ? 'N/A' : (v?.status || 'PENDIENTE');
    lot.verifBy = v?.by || null; lot.verifAt = v?.at || null;
    const rev = L.filter(l => l.vinfo && !l.extra).length;
    lot.verifProg = L.filter(l => !l.extra).length ? rev / L.filter(l => !l.extra).length : 0;
  }

  /* resumen por SKU */
  const skus = {};
  const S = sku => (skus[sku] = skus[sku] || { sku, modelos: new Set(), lots: [], pend: 0, approved: 0, proposed: 0, gap: 0, inv: base.inventario[sku] || null, sobLotes: 0, repo: base.reposicion[sku] || [] });
  for (const lot of ordered) {
    if (lot.ens) continue;
    for (const ln of lot.lines) {
      if (ln.pend <= 0) continue;
      const s = S(ln.sku);
      s.modelos.add(lot.modelo || ln.modelo);
      s.lots.push({ key: lot.key, need: ln.need, pend: ln.pend, gap: ln.gap, prio: lot.prio });
      s.pend += ln.pend; s.approved += Math.min(ln.approved, ln.pend);
      s.proposed += ln.proposal.reduce((t, p) => t + p.qty, 0); s.gap += ln.gap;
    }
  }
  for (const sku in supply) {
    const s = skus[sku]; if (!s) continue;
    for (const e of Object.values(supply[sku])) if (e.src === 'LOTES') s.sobLotes += e.ini;
    s.left = Object.values(supply[sku]).filter(e => order.includes(e.src)).reduce((t, e) => t + Math.max(0, e.left), 0);
    s.over = Object.values(supply[sku]).some(e => e.left < 0);
  }

  const active = ordered.filter(l => !l.ens);
  const kpi = {
    total: ordered.length, ensamblados: ordered.length - active.length,
    activos: active.length,
    conFalt: active.filter(l => l.pend > 0).length,
    completables: active.filter(l => l.status === 'COMPLETABLE').length,
    completos: active.filter(l => l.status === 'COMPLETO').length,
    conBrecha: active.filter(l => l.status === 'CRÍTICO').length,
    lineasCrit: active.reduce((s, l) => s + l.nCrit, 0),
    realTot: active.reduce((s, l) => s + l.realTot, 0),
    done: active.reduce((s, l) => s + l.done, 0),
    unidPend: active.reduce((s, l) => s + l.need, 0),
    unidGap: active.reduce((s, l) => s + l.gap, 0),
    verificados: active.filter(l => l.verif === 'VERIFICADO').length,
  };
  kpi.avance = kpi.realTot ? kpi.done / kpi.realTot : 1;
  return { lots, ordered, skus, supply, kpi, approvalsAll, ingresosAll, allLines };
}

if (typeof module !== 'undefined') module.exports = { U, SOURCES, SRC_LABEL, parseWorkbook, compute, mesStart, prioKey };
