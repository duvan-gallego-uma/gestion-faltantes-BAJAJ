/* ===== Solicitud a Bajaj: reclamo de faltantes, pagos reportados y validadores ===== */
const LS_BJ = 'uma-lotes-ckd-v1-bajaj';
const OWN_SRC = ['MEZZ', 'CKD', 'BUFFER', 'CARRUSEL', 'HOMOLOGAS', 'CEDI', 'CA', 'OTRO'];
const BJ_SRC = ['REPO', 'REPOSICION'];
app.bj = { pagos: {}, sols: {} };
Object.assign(app.ui, { bjTab: 'sol', bjDiff: true, bjLotes: false, bjMes: [], bjModelo: [], bjAck: false, bjPq: '', bjPest: 'PEND', bjRecv: null, bjMail: null, bjShowErr: false, bjAnular: null });
PERMS.ADMIN.push('bajaj'); PERMS.SUPERVISOR.push('bajaj');
PERM_LABEL.bajaj = 'Solicitudes y pagos de Bajaj';
Object.assign(ACT_PERM, { bjGen: 'bajaj', bjRecvOpen: 'bajaj', bjRecvSave: 'bajaj', bjRecvUndo: 'bajaj', bjPagoAdd: 'bajaj', bjPagoDel: 'bajaj', bjSent: 'bajaj', bjAnularArm: 'bajaj', bjAnular: 'bajaj' });
INPUT_PERM.push(['[data-bjopt],#bjAck,#npSku,#npWo,#npCaja,#npQty,#npFecha,#rvQty,#rvObs', 'bajaj']);

/* ---------- pagos de Bajaj ---------- */
const pid = (sku, wo, caja) => ('x-' + sku + '-' + wo + '-' + caja).replace(/[^A-Za-z0-9_.~:@+-]/g, '_');
function pagosList() {
  const ov = app.bj.pagos, out = [], seen = new Set();
  for (const sku in app.base.reposicion) for (const p of app.base.reposicion[sku]) {
    const id = pid(sku, p.wo, p.caja); if (seen.has(id)) continue; seen.add(id);
    out.push({ id, sku, wo: p.wo, caja: p.caja, fecha: p.fecha, modelo: p.modelo, origen: 'EXCEL', qtyRep: null, estado: 'REPORTADO', qtyRec: 0, ...(ov[id] || {}) });
  }
  for (const id in ov) if (!seen.has(id) && ov[id].origen === 'MANUAL') out.push({ id, ...ov[id] });
  return out;
}
function repoRecibido() {
  const m = {};
  for (const p of pagosList()) if (p.estado === 'RECIBIDO' || p.estado === 'PARCIAL') m[p.sku] = (m[p.sku] || 0) + U.num(p.qtyRec);
  return m;
}
function enTransito(sku) { return pagosList().filter(p => p.sku === sku && (p.estado === 'REPORTADO' || p.estado === 'PARCIAL')); }
async function savePago(id, data) {
  if (data === null) delete app.bj.pagos[id]; else app.bj.pagos[id] = data;
  recompute(); render();
  if (app.mode === 'local' || !app.db) return saveLocalBj();
  try { if (data === null) await app.db.doc('pagosBajaj/' + id).delete(); else await app.db.doc('pagosBajaj/' + id).set(data); } catch (e) { writeErr(e); }
}
async function saveSol(id, data) {
  app.bj.sols[id] = data; render();
  if (app.mode === 'local' || !app.db) return saveLocalBj();
  try { await app.db.doc('solicitudesBajaj/' + id).set(data); } catch (e) { writeErr(e); }
}
function saveLocalBj() { try { localStorage.setItem(LS_BJ, JSON.stringify(app.bj)); } catch (e) { /* */ } }
function loadLocalBj() { try { const s = JSON.parse(localStorage.getItem(LS_BJ) || 'null'); if (s) app.bj = { pagos: s.pagos || {}, sols: s.sols || {} }; } catch (e) { /* */ } }
function snapBajaj() {
  app.db.collection('pagosBajaj').onSnapshot(snap => { const m = {}; for (const d of snap.docs) m[d.id] = clone(d.data()); app.bj.pagos = m; recompute(); rerender(); });
  app.db.collection('solicitudesBajaj').onSnapshot(snap => { const m = {}; for (const d of snap.docs) m[d.id] = clone(d.data()); app.bj.sols = m; rerender(); });
}

/* ---------- cálculo del reclamo ---------- */
function bjCompute() {
  const r = app.res, u = app.ui;
  const recLeft = { ...repoRecibido() };
  const sent = {}, drafts = {};
  for (const s of Object.values(app.bj.sols)) {
    if (s.estado === 'ANULADA') continue;
    for (const l of s.lines || []) { const k = l.key + '|' + l.sku; if (s.estado === 'ENVIADA') sent[k] = (sent[k] || 0) + l.qty; else (drafts[k] = drafts[k] || []).push(s.num); }
  }
  const groups = [];
  const lots = r.ordered.slice().sort((a, b) => a.prio < b.prio ? -1 : a.prio > b.prio ? 1 : 0);
  for (const lot of lots) {
    if (u.bjMes.length && !u.bjMes.includes(lot.mes || 'SIN MES')) continue;
    if (u.bjModelo.length && !u.bjModelo.includes(lot.modelo || 'SIN MODELO')) continue;
    const by = {};
    for (const ln of lot.lines) {
      const g = by[ln.sku] = by[ln.sku] || { key: lot.key, wo: lot.wo, lote: lot.lote, modelo: lot.modelo, sku: ln.sku, real: 0, reportada: 0, notificado: false, extra: false, provisional: false, verificado: true, hallazgos: new Set(), ingXls: 0, own: 0, lotes: 0, repoUsed: 0, pend: 0, motivos: new Set(), obs: [], lines: [] };
      g.lines.push(ln); g.real += ln.real; g.reportada += ln.reportada; g.notificado = g.notificado || ln.notificado; g.extra = g.extra || ln.extra;
      g.provisional = g.provisional || (ln.provisional && ln.real > 0); g.hallazgos.add(ln.hallazgo);
      if (ln.verified == null && lot.verif !== 'VERIFICADO') g.verificado = false;
      g.ingXls += ln.ingresada; g.pend += ln.pend;
      for (const i of ln.ingresos || []) { const q = U.num(i.qty); if (i.src === 'LOTES') g.lotes += q; else if (BJ_SRC.includes(i.src)) g.repoUsed += q; else g.own += q; }
      if (ln.vinfo?.motivo) g.motivos.add(ln.vinfo.motivo);
      if (ln.vinfo?.obs) g.obs.push(ln.vinfo.obs);
    }
    for (const g of Object.values(by)) {
      if (g.real <= 0) continue;
      g.recAlloc = Math.min(g.real, recLeft[g.sku] || 0); recLeft[g.sku] = (recLeft[g.sku] || 0) - g.recAlloc;
      g.base = Math.max(0, g.real - g.recAlloc - (u.bjLotes ? 0 : g.lotes));
      g.sent = sent[g.key + '|' + g.sku] || 0;
      g.qty = u.bjDiff ? Math.max(0, g.base - g.sent) : g.base;
      g.transit = enTransito(g.sku);
      g.drafts = drafts[g.key + '|' + g.sku] || [];
      g.own += g.ingXls;
      g.lot = lot;
      bjValidate(g);
      groups.push(g);
    }
  }
  /* validación a nivel SKU: ingresos desde reposición vs recibido */
  const rec = repoRecibido(), used = {};
  for (const g of groups) used[g.sku] = (used[g.sku] || 0) + g.repoUsed;
  for (const g of groups) if (used[g.sku] > (rec[g.sku] || 0)) g.val.push({ t: 'W', c: 'REPO', m: `Se registraron ${fmtN(used[g.sku])} unidades ingresadas desde Reposición Bajaj, pero solo ${fmtN(rec[g.sku] || 0)} figuran como recibidas en Pagos de Bajaj.` });
  const inc = groups.filter(g => g.qty > 0 && !g.val.some(v => v.t === 'E'));
  const exc = groups.filter(g => g.qty > 0 && g.val.some(v => v.t === 'E'));
  const warn = inc.filter(g => g.val.some(v => v.t === 'W'));
  return { groups, inc, exc, warn, sentSkip: groups.filter(g => g.qty === 0 && g.base > 0), tot: inc.reduce((t, g) => t + g.qty, 0) };
}
function bjValidate(g) {
  const v = g.val = [];
  if (!/^[A-Z0-9]{5,15}$/.test(g.sku)) v.push({ t: 'E', c: 'SKU', m: 'Formato de SKU no válido.' });
  if (!/^\d+$/.test(String(g.wo || ''))) v.push({ t: 'E', c: 'WO', m: 'El lote no tiene un WO numérico.' });
  if (!g.lote) v.push({ t: 'E', c: 'LOTE', m: 'El lote no tiene número de lote.' });
  if (!g.modelo) v.push({ t: 'E', c: 'MOD', m: 'El lote no tiene modelo.' });
  if (g.provisional) v.push({ t: 'E', c: 'PROV', m: 'Figura como «PENDIENTE REVISAR» y no tiene conteo físico.' });
  if (!Number.isInteger(g.qty)) v.push({ t: 'E', c: 'QTY', m: 'La cantidad no es un número entero.' });
  if (!g.verificado && !g.provisional) v.push({ t: 'W', c: 'NOVER', m: 'Sin verificación física registrada en la app; se usa la cantidad del Excel.' });
  if (app.maestro) { const d = descFor(g.sku, g.modelo); if (!d) v.push({ t: 'W', c: 'MAE', m: 'El SKU no está en el maestro packing list.' }); else if (d.otro) v.push({ t: 'W', c: 'MAEM', m: `El SKU está en el maestro para otro modelo (${d.mo}).` }); }
  if (!g.notificado) v.push({ t: 'W', c: 'NONOT', m: g.extra ? 'Hallazgo nuevo de la verificación física; Bajaj no lo notificó en el despacho.' : 'Bajaj no lo notificó en el despacho; puede pedir evidencia.' });
  if (g.reportada > 0 && g.real > g.reportada) v.push({ t: 'W', c: 'MAYOR', m: `El conteo físico (${fmtN(g.real)}) supera lo reportado (${fmtN(g.reportada)}).` });
  if (g.ingXls > 0) v.push({ t: 'W', c: 'INGX', m: `${fmtN(g.ingXls)} unidades figuran ingresadas en el Excel sin origen; confirma que no vinieron de un pago de Bajaj.` });
  if (g.drafts.length) v.push({ t: 'W', c: 'DRAFT', m: `También está en ${g.drafts.join(', ')} (borrador sin enviar).` });
  if (g.transit.length) v.push({ t: 'I', c: 'TRANS', m: `Bajaj reporta pago pendiente de recibir: ${g.transit.slice(0, 3).map(p => `WO ${p.wo} caja ${p.caja}`).join('; ')}${g.transit.length > 3 ? '…' : ''}. Se mantiene en el reclamo hasta recibirlo.` });
  if (g.sent > 0) v.push({ t: 'I', c: 'SENT', m: `Ya se reclamaron ${fmtN(g.sent)} unidades en solicitudes enviadas.` });
}

/* ---------- vistas ---------- */
const VAL_ICON = { E: '<span class="badge b-rech">Error</span>', W: '<span class="badge b-rev">Revisar</span>', I: '<span class="badge b-info">Info</span>' };
function vBajaj() {
  const u = app.ui;
  let out = head('Reclamaciones', 'Solicitud a Bajaj', 'Faltantes y reposición de inventario propio, menos los pagos de Bajaj ya recibidos.');
  out += `<div class="seg" role="tablist" style="margin-bottom:24px">${[['sol', 'Nueva solicitud'], ['pagos', 'Pagos de Bajaj'], ['hist', 'Historial']].map(([k, t]) => `<button data-act="bjTab" data-val="${k}" aria-pressed="${u.bjTab === k}">${t}</button>`).join('')}</div>`;
  if (u.bjTab === 'pagos') return out + vBjPagos();
  if (u.bjTab === 'hist') return out + vBjHist();
  return out + vBjSol();
}
function vBjSol() {
  const u = app.ui, c = bjCompute(), r = app.res;
  const meses = [...new Set(r.ordered.map(l => l.mes || 'SIN MES'))].sort((a, b) => (mesStart(a) || '9') < (mesStart(b) || '9') ? -1 : 1);
  const modelos = [...new Set(r.ordered.map(l => l.modelo || 'SIN MODELO'))].sort();
  const lotsN = new Set(c.inc.map(g => g.key)).size, skuN = new Set(c.inc.map(g => g.sku)).size;
  const comp = c.inc.reduce((t, g) => { t.pend += Math.min(g.qty, g.pend); t.own += g.own; return t; }, { pend: 0, own: 0 });
  let out = `<div class="kpis">
    ${metric('Unidades a reclamar', fmtN(c.tot), `${fmtN(skuN)} SKU en ${fmtN(lotsN)} lotes`)}
    ${metric('Aún faltan en lote', fmtN(comp.pend), 'motos o lotes incompletos')}
    ${metric('Reponer inventario propio', fmtN(comp.own), 'usado para completar lotes')}
    ${metric('Excluidas por error', fmtN(c.exc.length), c.exc.length ? 'líneas que no se enviarán' : 'sin errores', c.exc.length > 0)}
  </div>`;
  out += `<div class="card pad" style="margin-top:16px"><div class="filters" style="grid-template-columns:1fr 1fr 1.4fr 1.4fr;margin:0">
    ${msSelect('bjMes', 'Mes ensamble', meses.map(v => ({ v, n: r.ordered.filter(l => (l.mes || 'SIN MES') === v).length })))}
    ${msSelect('bjModelo', 'Modelo', modelos.map(v => ({ v, n: r.ordered.filter(l => (l.modelo || 'SIN MODELO') === v).length })))}
    <label class="switch"><input type="checkbox" data-bjopt="bjDiff" ${u.bjDiff ? 'checked' : ''}><span class="tr"></span><span class="small">Solo diferencias frente a solicitudes ya enviadas</span></label>
    <label class="switch"><input type="checkbox" data-bjopt="bjLotes" ${u.bjLotes ? 'checked' : ''}><span class="tr"></span><span class="small">Reclamar también lo cubierto con sobrantes de otros lotes</span></label>
  </div></div>`;

  /* panel de validación */
  const cnt = {}; for (const g of c.groups.filter(g => g.qty > 0)) for (const v of g.val) { const k = v.t + v.c; cnt[k] = cnt[k] || { t: v.t, m: v.m.replace(/\d[\d.,]*/g, '#').replace(/\(.*\)/, ''), n: 0, c: v.c }; cnt[k].n++; }
  const vlist = Object.values(cnt).sort((a, b) => 'EWI'.indexOf(a.t) - 'EWI'.indexOf(b.t) || b.n - a.n);
  out += `<div class="section"><div class="section-head"><h2 class="h2">Validación</h2><p class="small muted">${fmtN(c.exc.length)} con error · ${fmtN(c.warn.length)} por revisar · ${fmtN(c.inc.length)} líneas listas</p></div>`;
  out += vlist.length ? `<div class="card">${vlist.map(v => `<div class="spread" style="padding:12px 24px;border-top:1px solid var(--line)"><div class="row" style="flex-wrap:nowrap">${VAL_ICON[v.t]}<span class="small">${esc(VAL_TXT[v.c] || v.m)}</span></div><b class="mono">${fmtN(v.n)}</b></div>`).join('')}</div>`
    : '<div class="alert a-ok"><p class="t">Sin observaciones</p><p class="d">Todas las líneas pasaron las validaciones.</p></div>';
  out += `</div>`;

  const row = g => `<tr${g.val.some(v => v.t === 'E') ? ' style="box-shadow:inset 4px 0 0 var(--uma-red)"' : ''}>
    <td class="sku">${esc(g.key)}<div class="desc">${esc(g.modelo)}</div></td>
    <td class="sku">${esc(g.sku)}${descHtml(g.sku, g.modelo)}</td>
    <td class="num">${fmtN(g.real)}${g.verificado ? '' : '<div class="desc">Excel</div>'}</td>
    <td class="small">${g.notificado ? 'SI' : 'NO'}${g.reportada ? `<div class="muted">${fmtN(g.reportada)}</div>` : ''}</td>
    <td class="num">${g.recAlloc ? fmtN(g.recAlloc) : '—'}</td>
    <td class="num">${g.sent ? fmtN(g.sent) : '—'}</td>
    <td class="num"><b>${fmtN(g.qty)}</b></td>
    <td><div class="chips">${g.pend ? `<span class="chip">Falta en lote <b>${fmtN(Math.min(g.qty, g.pend))}</b></span>` : ''}${g.own ? `<span class="chip">Inv. propio <b>${fmtN(g.own)}</b></span>` : ''}${g.lotes ? `<span class="chip">Sobr. lotes <b>${fmtN(g.lotes)}</b></span>` : ''}</div></td>
    <td class="small">${g.transit.length ? g.transit.slice(0, 2).map(p => `WO ${esc(p.wo)} · caja ${esc(p.caja)}`).join('<br>') : '—'}</td>
    <td>${g.val.filter(v => v.t !== 'I').map(v => `<div class="row" style="flex-wrap:nowrap;gap:6px;margin-bottom:4px" title="${esc(v.m)}">${VAL_ICON[v.t]}<span class="small">${esc(VAL_SHORT[v.c] || v.c)}</span></div>`).join('') || '<span class="badge b-apto">OK</span>'}</td></tr>`;
  const thead = `<thead><tr><th>Lote</th><th>SKU</th><th class="num">Faltante real</th><th>Notif.</th><th class="num">Recibido Bajaj</th><th class="num">Ya enviado</th><th class="num">A reclamar</th><th>Composición</th><th>Pago en tránsito</th><th>Validación</th></tr></thead>`;
  out += `<div class="section"><div class="section-head"><h2 class="h2">Líneas a Reclamar</h2><p class="small muted">Pasa el cursor sobre una validación para ver el detalle</p></div>`;
  out += c.inc.length ? `<div class="tbl">${'<table>' + thead + '<tbody>' + c.inc.map(row).join('') + '</tbody></table>'}</div>` : '<div class="card pad"><p class="muted">No hay líneas para reclamar con estos filtros.</p></div>';
  if (c.exc.length) out += `<div class="section"><div class="spread" style="margin-bottom:16px"><div><h3 class="h3">Excluidas por Error</h3><p class="small muted">Corrige la causa (por ejemplo, verificando el lote) y vuelve a generar.</p></div><button class="btn btn-ghost btn-sm" data-act="bjShowErr">${app.ui.bjShowErr ? 'Ocultar' : `Ver ${fmtN(c.exc.length)} líneas`}</button></div>
    ${app.ui.bjShowErr ? `<div class="tbl"><table>${thead}<tbody>${c.exc.map(row).join('')}</tbody></table></div>` : ''}</div>`;
  out += `</div><div class="sticky-foot"><label class="switch">${c.warn.length ? `<input type="checkbox" id="bjAck" ${u.bjAck ? 'checked' : ''}><span class="tr"></span><span class="small">Revisé las ${fmtN(c.warn.length)} líneas con observaciones</span>` : '<span class="small muted">Sin observaciones pendientes</span>'}</label>
    <button class="btn btn-primary btn-lg" data-act="bjGen" ${c.inc.length && (!c.warn.length || u.bjAck) ? '' : 'disabled'}>Generar solicitud (${fmtN(c.tot)} unid.)</button></div>`;
  return out;
}
const VAL_TXT = {
  SKU: 'Formato de SKU no válido', WO: 'Lote sin WO numérico', LOTE: 'Lote sin número de lote', MOD: 'Lote sin modelo', PROV: '«PENDIENTE REVISAR» sin conteo físico: se excluye', QTY: 'Cantidad no entera',
  NOVER: 'Sin verificación física en la app (se usa la cantidad del Excel)', MAE: 'SKU no está en el maestro packing list', MAEM: 'SKU está en el maestro para otro modelo',
  NONOT: 'No notificado por Bajaj en el despacho', MAYOR: 'Conteo físico mayor que lo reportado', INGX: 'Unidades ingresadas en el Excel sin origen registrado',
  DRAFT: 'También está en un borrador sin enviar', REPO: 'Ingresos desde reposición superan lo recibido de Bajaj', TRANS: 'Bajaj reporta un pago aún no recibido (se mantiene en el reclamo)', SENT: 'Parte ya reclamada en solicitudes enviadas',
};
const VAL_SHORT = { SKU: 'SKU', WO: 'WO', LOTE: 'Lote', MOD: 'Modelo', PROV: 'Sin conteo', QTY: 'Cantidad', NOVER: 'Sin verificar', MAE: 'No en maestro', MAEM: 'Otro modelo', NONOT: 'No notificado', MAYOR: 'Conteo mayor', INGX: 'Ingreso sin origen', DRAFT: 'En borrador', REPO: 'Reposición' };

function vBjPagos() {
  const u = app.ui, q = u.bjPq.trim().toUpperCase();
  const all = pagosList();
  const list = all.filter(p => (u.bjPest === 'ALL' || (u.bjPest === 'PEND' ? (p.estado === 'REPORTADO' || p.estado === 'PARCIAL') : (p.estado === 'RECIBIDO' || p.estado === 'PARCIAL'))) && (!q || p.sku.includes(q) || String(p.wo).includes(q) || String(p.caja).toUpperCase().includes(q)))
    .sort((a, b) => (a.fecha || '') < (b.fecha || '') ? 1 : -1);
  const pend = all.filter(p => p.estado === 'REPORTADO').length, rec = all.filter(p => p.estado !== 'REPORTADO').length;
  let out = `<div class="alert a-info" style="margin-bottom:24px"><p class="t">Un pago cuenta solo cuando está en inventario</p><p class="d">Los pagos que Bajaj reporta (hoja COLOMBIA o registrados aquí) quedan «Reportados» y no descuentan del reclamo. Al recibirlos físicamente, registra la cantidad: se descuentan del reclamo y quedan disponibles como fuente «Reposición Bajaj recibida» para completar lotes.</p></div>`;
  out += `<div class="grid2" style="align-items:start"><div class="card pad"><p class="label">${fmtN(pend)} reportados · ${fmtN(rec)} recibidos</p><h3 class="h3" style="margin:4px 0 16px">Registrar Pago Reportado</h3>
    <div class="vrow2" style="grid-template-columns:1.2fr 1fr 1fr"><label class="field"><span>SKU</span><input class="inp mono" id="npSku" autocapitalize="characters"></label><label class="field"><span>WO del envío</span><input class="inp mono" id="npWo" inputmode="numeric"></label><label class="field"><span>Caja</span><input class="inp mono" id="npCaja"></label></div>
    <div class="vrow2" style="grid-template-columns:1fr 1fr;margin-top:8px"><label class="field"><span>Cantidad reportada</span><input class="inp mono" type="number" min="1" id="npQty"></label><label class="field"><span>Fecha de despacho</span><input class="inp" type="date" id="npFecha"></label></div>
    <div class="row" style="margin-top:16px"><button class="btn btn-primary" data-act="bjPagoAdd">Agregar pago</button></div></div>
    <div class="card pad"><label class="field"><span>Buscar SKU, WO o caja</span><input class="inp" id="bjPq" data-live value="${esc(u.bjPq)}"></label>
    <div class="seg" style="margin-top:16px">${[['PEND', 'Por recibir'], ['REC', 'Recibidos'], ['ALL', 'Todos']].map(([k, t]) => `<button data-act="bjPest" data-val="${k}" aria-pressed="${u.bjPest === k}">${t}</button>`).join('')}</div></div></div>`;
  out += `<div class="section"><div class="tbl" id="bjPagosTbl">${list.length ? `<table><thead><tr><th>SKU</th><th>WO envío</th><th>Caja</th><th>Despacho</th><th>Origen</th><th class="num">Reportada</th><th>Estado</th><th class="num">Recibida</th><th>Recibió</th><th></th></tr></thead><tbody>
    ${list.slice(0, 300).map(p => `<tr><td class="sku">${esc(p.sku)}${descHtml(p.sku, p.modelo)}</td><td class="mono small">${esc(p.wo)}</td><td class="mono small">${esc(p.caja)}</td><td class="small">${fmtD(p.fecha)}</td><td class="small">${p.origen === 'EXCEL' ? 'Excel COLOMBIA' : 'Manual'}</td>
      <td class="num">${p.qtyRep ? fmtN(p.qtyRep) : '—'}</td><td>${p.estado === 'RECIBIDO' ? '<span class="badge b-apto">Recibido</span>' : p.estado === 'PARCIAL' ? '<span class="badge b-rev">Parcial</span>' : '<span class="badge b-inac">Reportado</span>'}</td>
      <td class="num">${p.qtyRec ? fmtN(p.qtyRec) : '—'}</td><td class="small">${p.recBy ? `${esc(nm(p.recBy))}<div class="muted">${fmtTs(p.recAt)}</div>` : '—'}</td>
      <td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">${p.estado === 'RECIBIDO' ? `<button class="btn btn-ghost btn-sm" data-act="bjRecvUndo" data-id="${esc(p.id)}">Revertir</button>` : `<button class="btn btn-outline btn-sm" data-act="bjRecvOpen" data-id="${esc(p.id)}">Registrar recepción</button>`}${p.origen === 'MANUAL' && p.estado === 'REPORTADO' ? `<button class="btn btn-ghost btn-sm" data-act="bjPagoDel" data-id="${esc(p.id)}">Quitar</button>` : ''}</div></td></tr>
      ${u.bjRecv === p.id ? `<tr><td colspan="10" style="background:var(--soft);height:auto"><div class="vrow2" style="grid-template-columns:160px 1fr auto auto;align-items:end;padding:8px 0">
        <label class="field"><span>Cantidad recibida</span><input class="inp mono" type="number" min="1" id="rvQty" value="${p.qtyRep ? p.qtyRep - (p.qtyRec || 0) : ''}"></label><label class="field"><span>Observación</span><input class="inp" id="rvObs" placeholder="Ej. llegó en caja 686, verificado en bodega"></label>
        <button class="btn btn-primary" data-act="bjRecvSave" data-id="${esc(p.id)}">Guardar</button><button class="btn btn-ghost" data-act="bjRecvCancel">Cancelar</button></div></td></tr>` : ''}`).join('')}
    </tbody></table>${list.length > 300 ? `<p class="small muted" style="padding:12px">Se muestran 300 de ${fmtN(list.length)}; usa la búsqueda.</p>` : ''}` : '<p class="empty">No hay pagos con este filtro.</p>'}</div></div>`;
  return out;
}
function vBjHist() {
  const sols = Object.values(app.bj.sols).sort((a, b) => b.at - a.at);
  if (!sols.length) return '<div class="card pad"><p class="muted">Aún no hay solicitudes generadas.</p></div>';
  let out = `<div class="tbl"><table><thead><tr><th>Solicitud</th><th>Fecha</th><th>Generó</th><th class="num">Lotes</th><th class="num">SKU</th><th class="num">Unidades</th><th>Estado</th><th></th></tr></thead><tbody>
  ${sols.map(s => `<tr><td class="sku">${esc(s.num)}</td><td class="small">${fmtTs(s.at)}</td><td class="small">${esc(nm(s.by))}</td><td class="num">${fmtN(s.totals.lotes)}</td><td class="num">${fmtN(s.totals.skus)}</td><td class="num"><b>${fmtN(s.totals.qty)}</b></td>
    <td>${s.estado === 'ENVIADA' ? `<span class="badge b-apto">Enviada</span><div class="desc">${fmtTs(s.enviadaAt)} · ${esc(nm(s.enviadaBy))}</div>` : s.estado === 'ANULADA' ? '<span class="badge b-inac">Anulada</span>' : '<span class="badge b-rev">Borrador</span>'}</td>
    <td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end"><button class="btn btn-outline btn-sm" data-act="bjExport" data-id="${esc(s.id)}">Excel</button><button class="btn btn-ghost btn-sm" data-act="bjMail" data-id="${esc(s.id)}">Correo</button>
      ${s.estado === 'BORRADOR' ? `<button class="btn btn-primary btn-sm" data-act="bjSent" data-id="${esc(s.id)}">Marcar enviada</button>` : ''}
      ${s.estado !== 'ANULADA' ? (app.ui.bjAnular === s.id ? `<button class="btn btn-danger btn-sm" data-act="bjAnular" data-id="${esc(s.id)}">Confirmar anulación</button>` : `<button class="btn btn-ghost btn-sm" data-act="bjAnularArm" data-id="${esc(s.id)}">Anular</button>`) : ''}</div></td></tr>
    ${app.ui.bjMail === s.id ? `<tr><td colspan="8" style="background:var(--soft);height:auto"><p class="label" style="margin:8px 0">Borrador de correo · revisar antes de enviar</p><textarea class="inp" rows="14" readonly style="font-family:var(--uma-mono);font-size:13px">${esc(bjMailText(s))}</textarea><p class="small muted" style="margin:8px 0">Adjunta el Excel de la solicitud. Este texto es un borrador sujeto a revisión humana antes de enviarlo a Bajaj.</p></td></tr>` : ''}`).join('')}
  </tbody></table></div>`;
  return out;
}

/* ---------- acciones ---------- */
async function bjGenerate() {
  const c = bjCompute(); if (!c.inc.length) return;
  if (c.warn.length && !app.ui.bjAck) return toast('Confirma que revisaste las observaciones.');
  const y = new Date().getFullYear();
  const n = Object.values(app.bj.sols).filter(s => (s.num || '').startsWith('SOL-' + y)).length + 1;
  const num = `SOL-${y}-${String(n).padStart(3, '0')}`;
  const lines = c.inc.map(g => ({
    key: g.key, wo: g.wo, lote: g.lote, modelo: g.modelo, sku: g.sku, desc: (descFor(g.sku, g.modelo) || {}).es || '', descEn: (descFor(g.sku, g.modelo) || {}).en || '',
    real: g.real, reportada: g.reportada, notificado: g.notificado, recibido: g.recAlloc, yaEnviado: g.sent, qty: g.qty,
    faltaLote: Math.min(g.qty, g.pend), invPropio: g.own, sobrLotes: g.lotes, verificado: g.verificado,
    verifPor: g.lot.verifBy ? nm(g.lot.verifBy) : '', verifAt: g.lot.verifAt || null, motivos: [...g.motivos].join(', '), obs: g.obs.join(' | '),
    transito: g.transit.map(p => `WO ${p.wo} caja ${p.caja}`).join('; '), obsVal: g.val.filter(v => v.t !== 'E').map(v => v.m).join(' | '),
  }));
  const id = rid();
  const s = { id, num, at: Date.now(), by: me(), estado: 'BORRADOR', lines, opciones: { soloDiferencias: app.ui.bjDiff, incluyeSobrantesLotes: app.ui.bjLotes, meses: app.ui.bjMes, modelos: app.ui.bjModelo },
    totals: { qty: c.tot, lotes: new Set(lines.map(l => l.key)).size, skus: new Set(lines.map(l => l.sku)).size, excluidas: c.exc.length, observaciones: c.warn.length } };
  app.ui.bjAck = false; app.ui.bjTab = 'hist';
  await saveSol(id, s);
  toast(`${num} generada como borrador`);
}
function bjMailText(s) {
  const t = s.totals;
  return `BORRADOR – REVISAR ANTES DE ENVIAR\n\nSubject: Shortage & replacement claim ${s.num} – Grupo UMA Colombia\n\nDear Bajaj team,\n\nPlease find attached claim ${s.num} for parts short-supplied in CKD shipments to Colombia.\n\nSummary\n- Lots (WO/Lot): ${t.lotes}\n- Part numbers: ${t.skus}\n- Total quantity claimed: ${t.qty}\n\nQuantities are based on the physical count of each lot, net of replacement parts already received in our inventory. Parts you reported as dispatched but not yet received are kept in the claim and marked in the attachment with their WO and case number. Quantities we covered with our own stock to complete production are included for replenishment.\n\nKindly confirm the dispatch plan for these parts, indicating WO and case numbers.\n\nBest regards,\n${acct()?.nombre || ''}\nGrupo UMA – Planta CKD`;
}
async function bjExport(id) {
  const s = app.bj.sols[id]; if (!s) return;
  if (!app.downloads) return toast('La descarga no está disponible en esta vista.');
  let X; try { X = await loadXLSX(); } catch (e) { return toast(e.message); }
  const hdr = [[`Claim ${s.num} · Grupo UMA Colombia · ${fmtD(new Date(s.at).toISOString().slice(0, 10))}`], [s.estado === 'ENVIADA' ? 'Sent' : 'DRAFT – subject to internal review / BORRADOR sujeto a revisión'], []];
  const claim = hdr.concat([['WO No.', 'Lot', 'Model', 'Part No. (SKU)', 'Description', 'Descripción', 'Physical shortage qty', 'Notified by Bajaj at dispatch', 'Notified qty', 'Received from Bajaj', 'Previously claimed', 'Qty claimed', 'Still missing in lot', 'Covered with UMA stock (to replenish)', 'Bajaj reported in transit (WO / case)', 'Physically verified', 'Verified by', 'Reason / Motivo', 'Remarks / Observaciones']]);
  for (const l of s.lines) claim.push([l.wo, l.lote, l.modelo, l.sku, l.descEn, l.desc, l.real, l.notificado ? 'YES' : 'NO', l.reportada, l.recibido, l.yaEnviado, l.qty, l.faltaLote, l.invPropio, l.transito, l.verificado ? 'YES' : 'NO (Excel)', l.verifPor, l.motivos, l.obs]);
  claim.push([], ['', '', '', 'TOTAL', '', '', '', '', '', '', '', s.totals.qty]);
  const bySku = {}; for (const l of s.lines) { const b = bySku[l.sku] = bySku[l.sku] || { sku: l.sku, desc: l.descEn || l.desc, qty: 0, lots: [] }; b.qty += l.qty; b.lots.push(`${l.wo}${l.lote}`); }
  const skuA = [['Part No. (SKU)', 'Description', 'Qty claimed', 'Lots']].concat(Object.values(bySku).sort((a, b) => b.qty - a.qty).map(b => [b.sku, b.desc, b.qty, b.lots.join(', ')]));
  const valA = [['Lote', 'SKU', 'Observaciones de validación (interno)']].concat(s.lines.filter(l => l.obsVal).map(l => [l.key, l.sku, l.obsVal]));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(claim), 'Claim');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(skuA), 'Summary by part');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(valA), 'Validaciones (interno)');
  const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
  try { await app.downloads.save({ filename: `${s.num}_Bajaj_claim.xlsx`, data: new Blob([buf]) }); toast('Archivo exportado'); }
  catch (e) { if (e.code !== 'declined') toast('No se pudo exportar el archivo.'); }
}
async function onBjAction(a, t) {
  const id = t.dataset.id, u = app.ui;
  if (a === 'bjTab') { u.bjTab = t.dataset.val; return render(); }
  if (a === 'bjShowErr') { u.bjShowErr = !u.bjShowErr; return render(); }
  if (a === 'bjPest') { u.bjPest = t.dataset.val; return render(); }
  if (a === 'bjGen') return bjGenerate();
  if (a === 'bjExport') return bjExport(id);
  if (a === 'bjMail') { u.bjMail = u.bjMail === id ? null : id; return render(); }
  if (a === 'bjSent') { const s = app.bj.sols[id]; await saveSol(id, { ...s, estado: 'ENVIADA', enviadaAt: Date.now(), enviadaBy: me() }); return toast(`${s.num} marcada como enviada`); }
  if (a === 'bjAnularArm') { u.bjAnular = id; return render(); }
  if (a === 'bjAnular') { const s = app.bj.sols[id]; u.bjAnular = null; await saveSol(id, { ...s, estado: 'ANULADA', anuladaAt: Date.now(), anuladaBy: me() }); return toast(`${s.num} anulada`); }
  if (a === 'bjRecvOpen') { u.bjRecv = id; return render(); }
  if (a === 'bjRecvCancel') { u.bjRecv = null; return render(); }
  if (a === 'bjRecvSave') {
    const p = pagosList().find(x => x.id === id); if (!p) return;
    const q = Math.round(U.num(document.getElementById('rvQty').value));
    if (q <= 0) return toast('Ingresa la cantidad recibida.');
    const tot = U.num(p.qtyRec) + q;
    const estado = p.qtyRep && tot < p.qtyRep ? 'PARCIAL' : 'RECIBIDO';
    if (p.qtyRep && tot > p.qtyRep) return toast(`Supera la cantidad reportada (${fmtN(p.qtyRep)}).`);
    u.bjRecv = null;
    const { id: _i, ...rest } = p;
    await savePago(id, { ...rest, estado, qtyRec: tot, recBy: me(), recAt: Date.now(), recObs: U.str(document.getElementById('rvObs')?.value) });
    return toast(`${fmtN(q)} unidades recibidas de Bajaj`);
  }
  if (a === 'bjRecvUndo') { const p = pagosList().find(x => x.id === id); const { id: _i, ...rest } = p; await savePago(id, { ...rest, estado: 'REPORTADO', qtyRec: 0, recBy: null, recAt: null, revertidoPor: me(), revertidoAt: Date.now() }); return toast('Recepción revertida'); }
  if (a === 'bjPagoAdd') {
    const sku = U.sku(document.getElementById('npSku').value), wo = U.str(document.getElementById('npWo').value).replace(/\D/g, ''), caja = U.str(document.getElementById('npCaja').value);
    const qty = Math.round(U.num(document.getElementById('npQty').value)), fecha = document.getElementById('npFecha').value || null;
    if (!/^[A-Z0-9]{5,15}$/.test(sku)) return toast('SKU no válido.');
    if (!wo) return toast('Indica el WO del envío.');
    if (qty <= 0) return toast('Indica la cantidad reportada.');
    const nid = 'm-' + rid();
    if (pagosList().some(p => p.sku === sku && String(p.wo) === wo && String(p.caja) === caja)) return toast('Ese pago (SKU, WO y caja) ya está registrado.');
    await savePago(nid, { sku, wo, caja, fecha, modelo: '', origen: 'MANUAL', qtyRep: qty, estado: 'REPORTADO', qtyRec: 0, by: me(), at: Date.now() });
    return toast('Pago reportado agregado');
  }
  if (a === 'bjPagoDel') return savePago(id, null);
}
