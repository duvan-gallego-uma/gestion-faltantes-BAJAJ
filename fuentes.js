/* ===== Rough Cut (programación de ensamble) y Maestro Packing List ===== */
const RC_URL = 'https://unidadesautomotrices-my.sharepoint.com/:x:/r/personal/andres_munoz_grupouma_com/_layouts/15/Doc.aspx?sourcedoc=%7B3ADA1EB1-FDEE-4655-A76D-C2CAF3C792DE%7D&file=ROUGH%20CUT%20OCTUBRE.xlsm&action=default&mobileredirect=true';
const MP_URL = 'https://unidadesautomotrices.sharepoint.com/sites/GESTION_TORNILLERIA_UMAZF/Lists/MAESTRO_PACKING_LIST/AllItems.aspx';

app.st.prog = null;      // { items: {key: {fecha}}, file, at, by }
app.st.rcmap = null;     // mapeo recordado
app.maestro = null;      // { byModel: {}, bySku: {}, n, file, at, by }
app.rc = null;           // importación de rough cut en curso
app.mpPending = null;

/* ---------- utilidades ---------- */
function anyDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return d2iso(v);
  if (typeof v === 'number') {
    if (v > 30000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const d = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  return null;
}
function mesDe(iso) { const [y, m] = iso.split('-').map(Number); return MESES[m - 1] + ' ' + y; }
function normLote(v) { const s = U.up(v); const m = s.match(/(\d+)/); return m ? 'L' + Number(m[1]) : ''; }
function normModel(v) { return U.up(v).replace(/[^A-Z0-9]/g, ''); }
const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

async function readWorkbookRaw(file) {
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const raw = {};
  for (const n of wb.SheetNames) {
    try { raw[n] = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true }); } catch (e) { raw[n] = []; }
  }
  return raw;
}

/* ---------- Rough Cut ---------- */
function rcGuess(rows) {
  let best = null;
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const H = (rows[h] || []).map(U.up);
    const wo = H.findIndex(x => /(^|\s)WO(\s|$)|W\/O|WORK ORDER|ORDEN/.test(x) && !x.includes('/LOTE'));
    const key = H.findIndex(x => x.replace(/\s/g, '') === 'WO/LOTE' || x.includes('LLAVE'));
    const lote = H.findIndex(x => /(^|\s)LOTE/.test(x) && !x.includes('/'));
    let fecha = H.findIndex(x => x.includes('ENSAMBLE') && x.includes('FECHA'));
    if (fecha < 0) fecha = H.findIndex(x => x.includes('ENSAMBLE'));
    if (fecha < 0) fecha = H.findIndex(x => x.includes('FECHA'));
    if ((wo < 0 && key < 0) || fecha < 0) continue;
    const g = { hdr: h, cWo: wo >= 0 ? wo : key, cLote: wo >= 0 ? lote : -1, cFecha: fecha };
    const sc = rcParse(rows, g).rows.length;
    if (!best || sc > best.sc) best = { ...g, sc };
  }
  return best;
}
function rcParse(rows, g) {
  const out = {}; let total = 0;
  for (let i = g.hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const woRaw = r[g.cWo]; if (woRaw == null || woRaw === '') continue;
    let key;
    if (g.cLote >= 0) { const wo = String(woRaw).replace(/\D/g, ''); const lo = normLote(r[g.cLote]); if (!wo || !lo) continue; key = wo + lo; }
    else { key = U.key(woRaw); if (!/^\d+L\d+$/.test(key)) continue; }
    const f = anyDate(r[g.cFecha]); if (!f) continue;
    total++;
    if (!out[key] || f < out[key]) out[key] = f;
  }
  return { rows: Object.entries(out).map(([key, fecha]) => ({ key, fecha })), total };
}
async function rcFile(file) {
  if (!app.canWrite) return toast('No tienes permisos de edición.');
  app.ui.view = 'datos'; app.rc = { file: file.name, loading: true }; render();
  try {
    const raw = await readWorkbookRaw(file);
    const sheets = Object.keys(raw).filter(n => raw[n].length);
    let pick = null;
    const mp = app.st.rcmap;
    if (mp && raw[mp.sheet]) {
      const H = (raw[mp.sheet][mp.hdr] || []).map(U.up);
      const idx = t => t == null ? -1 : H.indexOf(t);
      const g = { hdr: mp.hdr, cWo: idx(mp.wo), cLote: mp.lote ? idx(mp.lote) : -1, cFecha: idx(mp.fecha) };
      if (g.cWo >= 0 && g.cFecha >= 0) pick = { sheet: mp.sheet, ...g, remembered: true };
    }
    if (!pick) {
      for (const n of sheets) { const g = rcGuess(raw[n]); if (g && (!pick || g.sc > pick.sc)) pick = { sheet: n, ...g }; }
    }
    if (!pick) pick = { sheet: sheets[0], hdr: 0, cWo: -1, cLote: -1, cFecha: -1 };
    app.rc = { file: file.name, raw, sheets, ...pick };
  } catch (e) { app.rc = { file: file.name, error: e.message || String(e) }; }
  render();
}
function rcPreview() {
  const rc = app.rc;
  if (!rc || !rc.raw || rc.cWo < 0 || rc.cFecha < 0) return null;
  const { rows, total } = rcParse(rc.raw[rc.sheet] || [], rc);
  const lots = app.res.lots;
  const match = rows.filter(r => lots[r.key]);
  const changes = match.filter(r => (lots[r.key].fechaProg || '') !== r.fecha);
  return { rows, total, match, changes, unmatched: rows.filter(r => !lots[r.key]) };
}
function vRoughCut() {
  const rc = app.rc, p = app.st.prog;
  let out = `<div class="card pad" id="rcCard"><p class="label">Planeación de la producción</p><h3 class="h3" style="margin:4px 0 8px">Programación desde Rough Cut</h3>
    <p class="small muted" style="margin-bottom:16px">Toma la fecha de ensamble de cada WO/LOTE del Rough Cut y calcula el día y el mes de ensamble. Descarga el archivo desde OneDrive (Archivo › Guardar como › Descargar una copia) y cárgalo aquí; el conector de Microsoft 365 no puede leer archivos .xlsm.</p>
    <div class="row"><button class="btn btn-primary" data-act="rcPick" ${app.canWrite ? '' : 'disabled'}>Cargar Rough Cut</button><a class="btn btn-ghost" href="${RC_URL}" target="_blank" rel="noopener">Abrir en OneDrive</a></div>`;
  if (p && p.items) out += `<p class="small muted" style="margin-top:16px">Vigente: ${esc(p.file)} · ${fmtN(Object.keys(p.items).length)} lotes · ${fmtTs(p.at)} por ${esc(nm(p.by))} <button class="btn btn-ghost btn-sm" data-act="rcClear" ${app.canWrite ? '' : 'disabled'}>Quitar</button></p>`;
  if (rc) {
    out += `<div class="hr"></div>`;
    if (rc.loading) out += `<p class="muted">Leyendo ${esc(rc.file)}…</p>`;
    else if (rc.error) out += `<div class="alert a-danger"><p class="t">No se pudo leer el archivo</p><p class="d">${esc(rc.error)}</p></div>`;
    else {
      const rows = rc.raw[rc.sheet] || [], H = rows[rc.hdr] || [];
      const ncol = Math.max(H.length, ...(rows.slice(rc.hdr + 1, rc.hdr + 30).map(r => (r || []).length)));
      const colOpts = (sel, none) => (none ? `<option value="-1" ${sel < 0 ? 'selected' : ''}>${none}</option>` : '') + Array.from({ length: ncol }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${colName(i)} · ${esc(U.str(H[i]).slice(0, 40) || '(sin título)')}</option>`).join('');
      out += `<p class="sub">${esc(rc.file)}</p>${rc.remembered ? '<p class="small muted">Se usó el mismo mapeo de la última carga.</p>' : '<p class="small muted">Columnas detectadas automáticamente; ajústalas si no corresponden.</p>'}
      <div class="vrow2" style="grid-template-columns:2fr 1fr;margin-top:16px">
        <label class="field"><span>Hoja</span><select class="inp" data-rc="sheet">${rc.sheets.map(n => `<option ${n === rc.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Fila de encabezado</span><input class="inp mono" type="number" min="1" data-rc="hdr" value="${rc.hdr + 1}"></label>
      </div>
      <div class="vrow2" style="grid-template-columns:1fr 1fr 1fr;margin-top:8px">
        <label class="field"><span>Columna WO</span><select class="inp" data-rc="cWo">${colOpts(rc.cWo, '—')}</select></label>
        <label class="field"><span>Columna lote</span><select class="inp" data-rc="cLote">${colOpts(rc.cLote, 'La WO ya incluye el lote')}</select></label>
        <label class="field"><span>Fecha de ensamble</span><select class="inp" data-rc="cFecha">${colOpts(rc.cFecha, '—')}</select></label>
      </div>`;
      const pv = rcPreview();
      if (!pv) out += `<div class="alert a-warn" style="margin-top:16px"><p class="t">Faltan columnas</p><p class="d">Indica la columna de WO y la de fecha de ensamble.</p></div>`;
      else {
        out += `<div class="meta" style="margin:24px 0 16px">${[['Lotes en el Rough Cut', pv.rows.length], ['Coinciden con la app', pv.match.length], ['Cambian de fecha', pv.changes.length], ['No están en la app', pv.unmatched.length]].map(([a, c]) => `<div><span class="label">${a}</span><b class="mono" style="font-size:20px">${fmtN(c)}</b></div>`).join('')}</div>`;
        if (pv.changes.length) out += `<div class="tbl" style="max-height:280px;overflow:auto"><table><thead><tr><th>Lote</th><th>Actual</th><th>Rough Cut</th><th>Mes de ensamble</th></tr></thead><tbody>${pv.changes.slice(0, 60).map(r => { const l = app.res.lots[r.key]; return `<tr><td class="sku">${esc(r.key)}</td><td class="small">${l.fechaProg ? fmtD(l.fechaProg) : esc(l.progTxt || l.mes || '—')}</td><td class="small"><b>${fmtD(r.fecha, true)}</b></td><td class="small">${esc(mesDe(r.fecha))}</td></tr>`; }).join('')}</tbody></table></div>${pv.changes.length > 60 ? `<p class="small muted" style="margin-top:8px">y ${pv.changes.length - 60} más</p>` : ''}`;
        if (pv.rows.length && !pv.match.length) out += `<div class="alert a-warn" style="margin-top:16px"><p class="t">Ningún lote coincide</p><p class="d">Revisa la hoja y las columnas. Ejemplo leído: ${esc(pv.rows.slice(0, 3).map(r => r.key + ' ' + r.fecha).join(' · '))}</p></div>`;
        out += `<p class="small muted" style="margin-top:12px">Si un lote aparece en varias filas se toma la fecha más temprana. Los lotes que no están en el Rough Cut conservan la fecha del Excel.</p>
        <div class="row" style="margin-top:16px"><button class="btn btn-primary" data-act="rcApply" ${pv.match.length ? '' : 'disabled'}>Aplicar programación (${fmtN(pv.match.length)} lotes)</button><button class="btn btn-ghost" data-act="rcCancel">Cancelar</button></div>`;
      }
    }
  }
  return out + `</div>`;
}
async function rcApply() {
  const pv = rcPreview(); if (!pv) return;
  const rc = app.rc, H = (rc.raw[rc.sheet][rc.hdr] || []).map(U.up);
  const items = {}; for (const r of pv.match) items[r.key] = { fecha: r.fecha };
  const doc = { items, file: rc.file, at: Date.now(), by: me() };
  const map = { sheet: rc.sheet, hdr: rc.hdr, wo: H[rc.cWo] ?? null, lote: rc.cLote >= 0 ? H[rc.cLote] ?? null : null, fecha: H[rc.cFecha] ?? null, at: Date.now() };
  app.st.prog = doc; app.st.rcmap = map; app.rc = null; recompute(); render();
  if (app.mode === 'local') saveLocal();
  else if (app.db) { try { await app.db.doc('config/prog').set(doc); await app.db.doc('config/rcmap').set(map); } catch (e) { return writeErr(e); } }
  toast(`Programación aplicada a ${fmtN(pv.match.length)} lotes`);
}
async function rcClear() {
  app.st.prog = null; recompute(); render();
  if (app.mode === 'local') saveLocal();
  else if (app.db) { try { await app.db.doc('config/prog').delete(); } catch (e) { writeErr(e); } }
  toast('Programación del Rough Cut retirada');
}

/* ---------- Maestro packing list ---------- */
function mpParse(raw) {
  for (const n of Object.keys(raw)) {
    const rows = raw[n];
    for (let h = 0; h < Math.min(rows.length, 30); h++) {
      const H = (rows[h] || []).map(U.up);
      const ref = H.findIndex(x => x === 'REFERENCIA' || x === 'SKU' || x === 'NUMERO DE PARTE' || x === 'PART NO');
      const es = H.findIndex(x => x.includes('DESCRIPCION EN ESPA') || x.includes('DESCRIPCIÓN EN ESPA'));
      const en = H.findIndex(x => x.includes('DESCRIPCION EN INGL') || x.includes('DESCRIPCIÓN EN INGL') || x === 'DESCRIPTION');
      const mo = H.findIndex(x => x === 'MODELO' || x === 'MODEL');
      if (ref < 0 || (es < 0 && en < 0)) continue;
      const cv = H.findIndex(x => x.includes('CANTIDAD POR VEH')), est = H.findIndex(x => x.startsWith('ESTACI')), lin = H.findIndex(x => x === 'LINEA');
      const items = [];
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i] || []; const sku = U.sku(r[ref]); if (!sku) continue;
        items.push([mo >= 0 ? U.str(r[mo]) : '', sku, es >= 0 ? U.str(r[es]) : '', en >= 0 ? U.str(r[en]) : '', cv >= 0 ? U.num(r[cv]) : 0, est >= 0 ? U.str(r[est]) : '', lin >= 0 ? U.str(r[lin]) : '']);
      }
      if (items.length) return { sheet: n, items, modelos: [...new Set(items.map(x => x[0]).filter(Boolean))] };
    }
  }
  return null;
}
function mpIndex(items, info) {
  const byModel = {}, bySku = {};
  for (const [mo, sku, es, en, cv, est, lin] of items) {
    const d = { mo, es, en, cv, est, lin };
    byModel[normModel(mo) + '|' + sku] = d;
    if (!bySku[sku]) bySku[sku] = d;
  }
  return { byModel, bySku, n: items.length, models: [...new Set(items.map(x => normModel(x[0])))], ...info };
}
function descFor(sku, modelo) {
  const M = app.maestro; if (!M) return null;
  const nmo = normModel(modelo);
  let d = M.byModel[nmo + '|' + sku];
  if (!d && nmo) { const alt = M.models.find(m => m && (m.includes(nmo) || nmo.includes(m))); if (alt) d = M.byModel[alt + '|' + sku]; }
  if (d) return { ...d, otro: false };
  d = M.bySku[sku];
  return d ? { ...d, otro: true } : null;
}
function maestroBanner() {
  if (app.maestro) return '';
  return `<div class="alert a-info" style="margin:24px 0"><div class="spread"><div><p class="t">Descripciones de SKU no cargadas</p><p class="d">Carga el maestro packing list una vez y todos los SKU mostrarán su descripción en todas las pantallas, para todo el equipo.</p></div><button class="btn btn-outline btn-sm" data-act="mpPick" ${app.canWrite ? '' : 'disabled'}>Cargar maestro</button></div></div>`;
}
function descHtml(sku, modelo) {
  if (!app.maestro) return '';
  const d = descFor(sku, modelo); if (!d) return '<div class="desc">Sin descripción en el maestro</div>';
  const t = d.es || d.en;
  return `<div class="desc" title="${esc((d.en ? d.en + ' · ' : '') + (d.mo ? 'Modelo maestro: ' + d.mo : ''))}">${esc(t)}${d.cv ? ` · ${fmtN(d.cv)}/veh.` : ''}${d.est ? ` · Est. ${esc(d.est)}` : ''}${d.otro ? ' <span class="muted">(otro modelo)</span>' : ''}</div>`;
}
async function mpFile(file) {
  if (!app.canWrite) return toast('No tienes permisos de edición.');
  app.ui.view = 'datos'; app.mpPending = { file: file.name, loading: true }; render();
  try {
    const raw = await readWorkbookRaw(file);
    const r = mpParse(raw);
    if (!r) throw new Error('No se encontraron las columnas REFERENCIA y DESCRIPCION EN ESPAÑOL (o EN INGLES).');
    const skus = new Set(app.res.allLines.map(l => l.sku));
    app.mpPending = { file: file.name, ...r, cubre: [...skus].filter(s => r.items.some(x => x[1] === s)).length, skus: skus.size };
  } catch (e) { app.mpPending = { file: file.name, error: e.message || String(e) }; }
  render();
}
function vMaestro() {
  const M = app.maestro, p = app.mpPending;
  let out = `<div class="card pad" id="mpCard"><p class="label">Tornillería UMA ZF</p><h3 class="h3" style="margin:4px 0 8px">Descripción de SKU por Modelo</h3>
    <p class="small muted" style="margin-bottom:16px">Carga el maestro de packing list para mostrar la descripción en español, cantidad por vehículo y estación de cada SKU según el modelo del lote. Desde la lista de SharePoint usa «Exportar › Exportar a Excel» o «Exportar a CSV», o carga un libro que ya tenga la exportación (por ejemplo MACRO 200 SC L1.xlsx).</p>
    <div class="row"><button class="btn btn-primary" data-act="mpPick" ${app.canWrite ? '' : 'disabled'}>Cargar maestro</button><a class="btn btn-ghost" href="${MP_URL}" target="_blank" rel="noopener">Abrir lista en SharePoint</a></div>`;
  if (M) out += `<p class="small muted" style="margin-top:16px">Vigente: ${esc(M.file)} · ${fmtN(M.n)} referencias · ${fmtTs(M.at)} por ${esc(nm(M.by))}</p>`;
  if (p) {
    out += `<div class="hr"></div>`;
    if (p.loading) out += `<p class="muted">Leyendo ${esc(p.file)}…</p>`;
    else if (p.error) out += `<div class="alert a-danger"><p class="t">No se pudo leer el archivo</p><p class="d">${esc(p.error)}</p></div><div class="row" style="margin-top:16px"><button class="btn btn-ghost" data-act="mpCancel">Cerrar</button></div>`;
    else out += `<p class="sub">${esc(p.file)} · hoja «${esc(p.sheet)}»</p>
      <div class="meta" style="margin:16px 0">${[['Referencias', p.items.length], ['Modelos', p.modelos.length], ['SKU con novedad cubiertos', `${fmtN(p.cubre)} de ${fmtN(p.skus)}`]].map(([a, c]) => `<div><span class="label">${a}</span><b class="mono" style="font-size:20px">${typeof c === 'number' ? fmtN(c) : c}</b></div>`).join('')}</div>
      <div class="row"><button class="btn btn-primary" data-act="mpApply">${app.mode === 'compartido' ? 'Publicar para el equipo' : 'Usar este maestro'}</button><button class="btn btn-ghost" data-act="mpCancel">Cancelar</button></div>`;
  }
  return out + `</div>`;
}
async function mpApply() {
  const p = app.mpPending; if (!p || !p.items) return;
  const info = { file: p.file, at: Date.now(), by: me() };
  app.maestro = mpIndex(p.items, info); app.mpPending = null; render();
  if (app.mode === 'local') { try { localStorage.setItem(LS_KEY + '-maestro', JSON.stringify({ items: p.items, info })); } catch (e) { /* */ } return toast('Maestro cargado'); }
  if (!app.db) return;
  try {
    toast('Publicando maestro…');
    const version = rid(), parts = chunk(p.items);
    for (let i = 0; i < parts.length; i++) await app.db.doc(`maestro/p-${i}`).set({ version, items: parts[i] });
    await app.db.doc('maestro/meta').set({ version, parts: parts.length, ...info });
    const old = await app.db.collection('maestro').get();
    for (const d of old.docs) if (d.id !== 'meta' && d.data().version !== version) { try { await app.db.doc('maestro/' + d.id).delete(); } catch (e) { /* */ } }
    toast('Maestro publicado para el equipo');
  } catch (e) { writeErr(e); }
}
function snapFuentes() {
  app.db.doc('config/prog').onSnapshot(s => { app.st.prog = s.exists ? clone(s.data()) : null; recompute(); rerender(); });
  app.db.doc('config/rcmap').onSnapshot(s => { app.st.rcmap = s.exists ? clone(s.data()) : null; });
  app.db.collection('maestro').onSnapshot(snap => {
    const docs = {}; for (const d of snap.docs) docs[d.id] = d.data();
    const meta = docs.meta; if (!meta) return;
    let items = [];
    for (let i = 0; i < meta.parts; i++) { const c = docs['p-' + i]; if (!c || c.version !== meta.version) return; items = items.concat(c.items); }
    app.maestro = mpIndex(items, { file: meta.file, at: meta.at, by: meta.by }); rerender();
  });
}
function loadLocalFuentes() {
  try { const m = JSON.parse(localStorage.getItem(LS_KEY + '-maestro') || 'null'); if (m) app.maestro = mpIndex(m.items, m.info); } catch (e) { /* */ }
}
