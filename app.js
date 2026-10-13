/* ===== App ===== */
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const LS_KEY = 'uma-lotes-ckd-v1';
const MOTIVOS = ['Faltante físico', 'Pieza dañada', 'Referencia equivocada', 'Mal etiquetado', 'Cantidad incompleta', 'Otro'];

const app = {
  base: null, baseInfo: { tipo: 'embebido', file: EMBED_FILE, at: EMBED_AT, by: null },
  st: { verif: {}, comp: {}, lotesApp: {} },
  fuentes: SOURCES.map(s => ({ id: s.id, on: true })),
  db: null, user: null, me: null, downloads: null, canWrite: true,
  mode: 'cargando', res: null, names: {}, pendingImport: null,
  ui: { view: 'tablero', lot: null, newLot: null, delArm: null, ingLine: null, ing: null, vLot: null, q: '', fEstado: [], fMes: [], fVerif: [], fModelo: [], msOpen: null, skuQ: '', skuGap: true, skuOpen: null, vq: '', vPend: true, closeAp: true },
};

/* ---------- utilidades ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Math.round(n || 0).toLocaleString('es-CO');
const pct = x => (Math.round((x || 0) * 1000) / 10).toFixed(1) + '%';
const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fmtD(iso, withDay) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (withDay ? DIAS[dt.getDay()] + ' ' : '') + `${d} ${MES_C[m - 1]} ${y}`;
}
function fmtTs(ts) { if (!ts) return '—'; const d = new Date(ts); return `${d.getDate()} ${MES_C[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function daysTo(iso) { const [y, m, d] = iso.split('-').map(Number); const [a, b, c] = TODAY.split('-').map(Number); return Math.round((new Date(y, m - 1, d) - new Date(a, b - 1, c)) / 86400000); }
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o || {}));
const srcTxt = (p) => p.src === 'LOTES' ? 'Lote ' + p.ref : SRC_LABEL[p.src] || EXTRA_SRC[p.src] || p.src;
function nm(id) { if (!id) return '—'; if (String(id).startsWith('acc:')) { const c = app.cuentas && app.cuentas[id.slice(4)]; return c ? c.nombre : id.slice(4); } if (app.me && id === app.me.id) return app.names[id] || 'Tú'; return app.names[id] || 'Usuario'; }

const ST_B = { 'COMPLETO': 'b-apto', 'COMPLETABLE': 'b-info', 'CRÍTICO': 'b-rech', 'SIN NOVEDAD': 'b-inac', 'ENSAMBLADO': 'b-inac' };
const ST_C = { 'COMPLETO': 'var(--uma-success)', 'COMPLETABLE': 'var(--uma-info)', 'CRÍTICO': 'var(--uma-danger)', 'ENSAMBLADO': 'var(--uma-neutral)', 'SIN NOVEDAD': 'var(--line)' };
const ST_ORDER = ['COMPLETO', 'COMPLETABLE', 'CRÍTICO', 'SIN NOVEDAD'];
const EXTRA_SRC = { REPOSICION: 'Reposición Bajaj', OTRO: 'Otro' };
const progress = (x, crit) => `<div class="progress" style="min-width:64px"><div style="width:${Math.min(100, (x || 0) * 100)}%${crit ? ';background:var(--uma-red)' : ''}"></div></div>`;
const V_B = { 'VERIFICADO': 'b-apto', 'EN CURSO': 'b-rev', 'PENDIENTE': 'b-inac' };
const badge = (s) => `<span class="badge ${ST_B[s] || 'b-inac'}">${esc(s)}</span>`;
const vbadge = (s) => s === 'N/A' ? '<span class="muted">—</span>' : `<span class="badge ${V_B[s] || 'b-inac'}">${esc(s)}</span>`;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 3200);
}

/* ---------- cálculo y render ---------- */
function mergedBase() {
  const lots = { ...app.base.lots };
  for (const k in app.st.lotesApp) if (!lots[k]) lots[k] = { ...app.st.lotesApp[k], origen: 'APP', enSeguimiento: false };
  const pg = app.st.prog && app.st.prog.items;
  if (pg) for (const k in pg) if (lots[k] && pg[k].fecha) lots[k] = { ...lots[k], fechaProg: pg[k].fecha, progTxt: '', mes: mesDe(pg[k].fecha), progSrc: 'RC', fechaExcel: lots[k].fechaProg, mesExcel: lots[k].mes };
  return { ...app.base, lots };
}
function recompute() { app.res = compute(mergedBase(), { ...app.st, repoRec: typeof repoRecibido === 'function' && app.bj ? repoRecibido() : {} }, app.fuentes); }
let renderQueued = false, deferred = false;
function render() {
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#main') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.dataset.live == null) { deferred = true; return; }
  deferred = false;
  const v = app.ui.view;
  const gate = isGated();
  document.body.classList.toggle('gated', gate);
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  const m = document.getElementById('main');
  let html = '';
  if (gate) html = vIngreso();
  else if (v === 'usuarios') html = vUsuarios();
  else if (v === 'sesion') html = vSesion();
  else if (v === 'bajaj') html = vBajaj();
  else if (v === 'tablero') html = vTablero();
  else if (v === 'lotes') html = app.ui.newLot ? vNuevoLote() : app.ui.lot ? vLote(app.ui.lot) : vLotes();
  else if (v === 'verif') html = app.ui.vLot ? vVerifLote(app.ui.vLot) : vVerif();
  else if (v === 'sku') html = vSku();
  else if (v === 'datos') html = vDatos();
  m.innerHTML = html;
  fillTxt(m); fillLoginIds(); applyPerms(m);
  syncBadge();
  resolveNames();
}
function rerender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
document.addEventListener('focusout', () => setTimeout(() => { if (deferred) render(); }, 0));

function syncBadge() {
  const s = document.getElementById('sync');
  const map = { cargando: ['Conectando…', 'var(--uma-neutral)'], compartido: ['Compartido con el equipo', 'var(--uma-success)'], local: ['Solo este navegador', 'var(--uma-warning)'], lectura: ['Solo lectura', 'var(--uma-neutral)'] };
  const [t, c] = map[app.mode] || map.cargando;
  s.textContent = t; s.style.setProperty('--dot', c);
}

function go(view, extra) {
  app.ui.view = view;
  if (view === 'lotes') { app.ui.lot = extra || null; app.ui.newLot = null; app.ui.delArm = null; app.ui.ingLine = null; app.ui.ing = null; }
  if (view === 'verif') app.ui.vLot = extra || null;
  render(); window.scrollTo(0, 0);
}

/* ---------- vistas ---------- */
function head(eyebrow, title, desc, actions) {
  return `<div class="page-head"><div class="t"><p class="label">${eyebrow}</p><h1 class="h1">${title}</h1>${desc ? `<p class="small muted">${desc}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
function srcLine() {
  const b = app.baseInfo;
  if (b.tipo === 'embebido' && !b.file) return 'Sin datos: carga el Excel de seguimiento en la sección Datos';
  return b.tipo === 'embebido' ? `Datos: ${esc(b.file)} · corte ${fmtD(b.at)}` : `Datos: ${esc(b.file || 'Excel')} · publicado ${fmtTs(b.at)} por ${esc(nm(b.by))}`;
}

function vTablero() {
  const r = app.res, k = r.kpi;
  const active = r.ordered.filter(l => !l.ens);
  const risk = active.filter(l => l.fechaProg && daysTo(l.fechaProg) <= 14 && (l.status === 'CRÍTICO' || l.provisional))
    .sort((a, b) => a.fechaProg < b.fechaProg ? -1 : 1);
  let out = head('Planta CKD · Seguimiento de lotes', 'Lotes con Novedades', srcLine(),
    `<button class="btn btn-outline" data-act="go" data-v="verif">Verificación física</button><button class="btn btn-primary" data-act="go" data-v="lotes">Ver lotes</button>`);

  out += `<div class="section-head" style="margin-top:0"><div><p class="label">Próximos 14 días</p><h2 class="h2">Riesgo de Paro de Línea</h2></div><p class="small muted">Lotes programados que no se completan con lo disponible</p></div>`;
  if (!risk.length) out += `<div class="alert a-ok"><p class="t">Sin lotes en riesgo</p><p class="d">Todos los lotes programados en los próximos 14 días están completos o se completan con la propuesta actual.</p></div>`;
  else out += `<div class="card risk">${risk.map(l => {
    const d = daysTo(l.fechaProg); const late = d < 0;
    return `<div class="risk-row" data-act="lot" data-k="${esc(l.key)}" role="button" tabindex="0">
      <div class="risk-date ${late ? 'late' : ''}"><b>${late ? '↓ ' + Math.abs(d) : d}</b><span>${late ? 'días vencido' : d === 1 ? 'día' : 'días'}</span></div>
      <div><p class="mono" style="font-weight:700;font-size:16px">${esc(l.key)}</p><p class="small muted">${esc(l.modelo)} · ${fmtD(l.fechaProg, true)} · ${l.nFalt} SKU con faltante${l.motosInc ? ' · ensamblado con motos incompletas' : ''}${l.provisional ? ' · incluye líneas por revisar' : ''}</p></div>
      <div class="row">${l.gap > 0 ? `<span class="small"><b class="mono" style="color:var(--uma-red)">${fmtN(l.gap)}</b> unid. sin fuente</span>` : ''}<span class="mono small">${pct(l.avance)}</span>${badge(l.status)}</div>
    </div>`;
  }).join('')}</div>`;

  out += `<div class="section kpis">
    ${metric('Avance de completado', pct(k.avance), `${fmtN(k.done)} de ${fmtN(k.realTot)} unidades faltantes ya ingresadas`)}
    ${metric('Lotes críticos', fmtN(k.conBrecha), `${pct(k.activos ? k.conBrecha / k.activos : 0)} de los lotes activos · ${fmtN(k.lineasCrit)} novedades sin fuente`, k.conBrecha > 0)}
    ${metric('Lotes completables', fmtN(k.completables), `${pct(k.activos ? k.completables / k.activos : 0)} se completan con lo disponible`)}
    ${metric('Verificación física', pct(k.activos ? k.verificados / k.activos : 0), `${fmtN(k.verificados)} de ${fmtN(k.activos)} lotes verificados`)}
  </div>`;
  const dist = ST_ORDER.map(s => ({ s, n: active.filter(l => l.status === s).length })).filter(x => x.n);
  out += `<div class="card pad" style="margin-top:16px"><div class="spread" style="margin-bottom:16px"><div><p class="label">${fmtN(k.activos)} lotes activos</p><h3 class="h3" style="margin-top:4px">Estado Porcentual de Lotes</h3></div></div>
    <div class="bar" style="height:40px">${dist.map(x => `<div style="width:${x.n / (k.activos || 1) * 100}%;background:${ST_C[x.s]}" title="${x.s}: ${x.n}"></div>`).join('')}</div>
    <div class="meta" style="margin-top:24px">${dist.map(x => `<div class="dist-item" role="button" tabindex="0" data-act="filterStatus" data-s="${esc(x.s)}" title="Ver lotes ${esc(x.s)}"><span class="label"><i class="dot" style="background:${ST_C[x.s]};margin-right:6px"></i>${x.s}</span><b class="mono" style="font-size:24px">${pct(x.n / (k.activos || 1))}</b><span class="small muted">${fmtN(x.n)} lotes · ver lista</span></div>`).join('')}</div>
  </div>`;

  /* programación */
  const groups = {};
  for (const l of active) {
    const g = l.fechaProg ? l.fechaProg : 'M:' + (l.mes || 'SIN MES');
    (groups[g] = groups[g] || []).push(l);
  }
  const gk = Object.keys(groups).sort((a, b) => {
    const pa = a.startsWith('M:') ? (mesStart(a.slice(2)) || '9999').slice(0, 7) + '-99' : a;
    const pb = b.startsWith('M:') ? (mesStart(b.slice(2)) || '9999').slice(0, 7) + '-99' : b;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  out += `<div class="section"><div class="section-head"><div><p class="label">Orden de atención</p><h2 class="h2">Programación de Ensamble</h2>${app.st.prog ? `<p class="small muted" style="margin-top:4px">Fechas del Rough Cut ${esc(app.st.prog.file)} · ${fmtTs(app.st.prog.at)}</p>` : ''}</div><div class="row">${legend()}<button class="btn btn-outline btn-sm" data-act="rcPick" ${app.canWrite ? '' : 'disabled'}>Actualizar desde Rough Cut</button></div></div>
    <div class="card">${gk.map(g => {
    const isM = g.startsWith('M:');
    const lbl = isM ? `<b>${esc(g.slice(2).toLowerCase().replace(/^./, c => c.toUpperCase()))}</b><span>Sin fecha programada</span>` : `<b>${fmtD(g, true)}</b><span>${daysTo(g) < 0 ? 'Vencida' : daysTo(g) === 0 ? 'Hoy' : daysTo(g) === 1 ? 'Mañana' : 'En ' + daysTo(g) + ' días'}</span>`;
    return `<div class="tl-row"><div class="tl-lbl">${lbl}</div><div class="chips">${groups[g].map(l => `<button class="lchip" data-act="lot" data-k="${esc(l.key)}" title="${esc(l.modelo + ' · ' + l.status)}"><span class="dot" style="background:${ST_C[l.status]}"></span>${esc(l.key)}</button>`).join('')}</div></div>`;
  }).join('')}</div></div>`;

  /* estado por mes + SKUs críticos */
  const meses = {};
  for (const l of active) { const m = l.mes || 'SIN MES'; (meses[m] = meses[m] || []).push(l); }
  const mk = Object.keys(meses).sort((a, b) => (mesStart(a) || '9') < (mesStart(b) || '9') ? -1 : 1);
  const stOrder = ST_ORDER;
  const topSku = Object.values(r.skus).filter(s => s.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 8);
  out += `<div class="section grid2">
    <div class="card pad"><p class="label">Por mes de ensamble · avance a la derecha</p><h3 class="h3" style="margin:4px 0 24px">Estado de Lotes</h3>
      <div class="bars">${mk.map(m => {
    const ls = meses[m]; const n = ls.length;
    return `<div class="bar-row"><span class="small" style="font-weight:700">${esc(m)}</span><div class="bar">${stOrder.map(s => { const c = ls.filter(l => l.status === s).length; return c ? `<div style="width:${c / n * 100}%;background:${ST_C[s]}" title="${s}: ${c}"></div>` : ''; }).join('')}</div><span class="num small" title="Avance de completado">${pct(ls.reduce((t, l) => t + l.done, 0) / (ls.reduce((t, l) => t + l.realTot, 0) || 1))}</span></div>`;
  }).join('')}</div>${legend()}</div>
    <div class="card pad"><div class="spread"><div><p class="label">Sin fuente interna</p><h3 class="h3" style="margin:4px 0 16px">SKU con Mayor Brecha</h3></div><button class="btn btn-ghost btn-sm" data-act="go" data-v="sku">Ver cruce</button></div>
      ${topSku.length ? `<table><thead><tr><th>SKU</th><th class="num">Lotes</th><th class="num">Pendiente</th><th class="num">Brecha</th></tr></thead><tbody>${topSku.map(s => `<tr class="click" data-act="skuopen" data-s="${esc(s.sku)}"><td class="sku">${esc(s.sku)}${descHtml(s.sku, [...s.modelos][0])}</td><td class="num">${s.lots.length}</td><td class="num">${fmtN(s.pend)}</td><td class="num" style="color:var(--uma-red);font-weight:700">${fmtN(s.gap)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Todos los faltantes tienen fuente.</p>'}
    </div></div>`;
  return out;
}
function metric(l, v, c, crit) { return `<div class="card metric ${crit ? 'crit' : ''}"><p class="label">${l}</p><p class="v">${v}</p><p class="c">${c}</p></div>`; }
function legend() {
  return `<div class="legend">${ST_ORDER.map(s => `<span><i class="dot" style="background:${ST_C[s]}"></i>${s.toLowerCase().replace(/^./, c => c.toUpperCase())}</span>`).join('')}</div>`;
}

function filteredLots() {
  const u = app.ui, q = u.q.trim().toUpperCase();
  return app.res.ordered.filter(l =>
    (!q || l.key.includes(q) || (l.modelo || '').toUpperCase().includes(q) || (l.ubic || '').toUpperCase().includes(q) || l.lines.some(x => x.sku.includes(q))) &&
    (!u.fEstado.length || u.fEstado.includes(l.status)) && (!u.fMes.length || u.fMes.includes(l.mes || 'SIN MES')) &&
    (!u.fVerif.length || u.fVerif.includes(l.verif)) && (!u.fModelo.length || u.fModelo.includes(l.modelo || 'SIN MODELO')));
}
function vLotes() {
  const u = app.ui; const r = app.res;
  const meses = [...new Set(r.ordered.map(l => l.mes || 'SIN MES'))].sort((a, b) => (mesStart(a) || '9') < (mesStart(b) || '9') ? -1 : 1);
  const modelos = [...new Set(r.ordered.map(l => l.modelo || 'SIN MODELO'))].sort();
  const ls = filteredLots();
  const nAct = u.fEstado.length + u.fMes.length + u.fVerif.length + u.fModelo.length + (u.q ? 1 : 0);
  let out = head('Planta CKD', 'Lotes', `${fmtN(r.ordered.length)} lotes · ordenados por prioridad de ensamble`, `<button class="btn btn-outline" data-act="rcPick" ${app.canWrite ? '' : 'disabled'}>Rough Cut</button><button class="btn btn-outline" data-act="export">Exportar Excel</button><button class="btn btn-primary" data-act="newLot" ${app.canWrite ? '' : 'disabled'}>Nuevo lote</button>`);
  out += `<div class="filters">
    <label class="field"><span>Buscar</span><input class="inp" data-live data-f="q" value="${esc(u.q)}" placeholder="Lote, modelo, ubicación o SKU"></label>
    ${msSelect('fEstado', 'Estado', Object.keys(ST_B).map(v => ({ v, n: r.ordered.filter(l => l.status === v).length })))}
    ${msSelect('fMes', 'Mes ensamble', meses.map(v => ({ v, n: r.ordered.filter(l => (l.mes || 'SIN MES') === v).length })))}
    ${msSelect('fModelo', 'Modelo', modelos.map(v => ({ v, n: r.ordered.filter(l => (l.modelo || 'SIN MODELO') === v).length })))}
    ${msSelect('fVerif', 'Verificación', ['PENDIENTE', 'EN CURSO', 'VERIFICADO', 'N/A'].map(v => ({ v, t: v === 'N/A' ? 'NO APLICA (ENSAMBLADO)' : v, n: r.ordered.filter(l => l.verif === v).length })))}
  </div>`;
  out += `<div class="spread" style="margin:-8px 0 16px"><span class="small muted" id="lotsCount">${fmtN(ls.length)} lotes con estos filtros</span>${nAct ? '<button class="btn btn-ghost btn-sm" data-act="msReset">Limpiar filtros</button>' : ''}</div>`;
  out += `<div class="tbl" id="lotsTbl">${lotsTable(ls)}</div>`;
  return out;
}
function lotsTable(ls) {
  if (!ls.length) return '<p class="empty">No hay lotes con estos filtros.</p>';
  return `<table><thead><tr><th>Lote</th><th>Modelo</th><th>Ubicación</th><th>Ensamble</th><th class="num">SKU falt.</th><th class="num">Críticos</th><th>Avance</th><th class="num">Cobertura</th><th>Estado</th><th>Verificación</th></tr></thead><tbody>
  ${ls.map(l => `<tr class="click" data-act="lot" data-k="${esc(l.key)}">
    <td class="sku">${esc(l.key)}${l.origen === 'APP' ? ' <span class="badge b-info" title="Creado en la app">App</span>' : ''}${l.motosInc ? '<div class="desc" style="color:var(--uma-red);font-weight:700">Ensamblado · motos incompletas</div>' : ''}</td><td>${esc(l.modelo)}</td><td class="small">${esc(l.ubic || '—')}</td>
    <td class="small" style="white-space:nowrap">${l.fechaProg ? fmtD(l.fechaProg) : `<span class="muted">${esc(l.mes || '—')}</span>`}</td>
    <td class="num">${l.nFalt || '—'}</td><td class="num" style="${l.nCrit ? 'color:var(--uma-red);font-weight:700' : ''}">${l.nCrit || '—'}</td>
    <td style="min-width:140px">${l.lines.length ? `<div class="row" style="flex-wrap:nowrap">${progress(l.avance)}<span class="num small">${pct(l.avance)}</span></div>` : '<span class="muted">—</span>'}</td>
    <td class="num">${l.lines.length ? pct(l.cov) : '—'}</td><td>${badge(l.status)}</td><td>${vbadge(l.verif)}</td></tr>`).join('')}
  </tbody></table>`;
}

function propChips(ln) {
  const ap = (ln.approvals || []).map(a => `<span class="chip ok" title="Aprobado por ${esc(nm(a.by))}">✓ ${esc(srcTxt(a))} <b>${fmtN(a.qty)}</b></span>`);
  const pr = ln.proposal.map(p => `<span class="chip" title="${p.src === 'LOTES' ? esc('Ubicación: ' + (app.res.lots[p.ref]?.ubic || '—')) : ''}">${esc(srcTxt(p))} <b>${fmtN(p.qty)}</b></span>`);
  const all = ap.concat(pr);
  return all.length ? `<div class="chips">${all.join('')}</div>` : '<span class="muted">—</span>';
}
function vLote(key) {
  const l = app.res.lots[key];
  if (!l) return `<button class="back" data-act="go" data-v="lotes">← Lotes</button><p class="empty">Lote no encontrado.</p>`;
  const canAp = !l.ens && l.lines.some(x => x.proposal.length);
  let out = `<button class="back" data-act="go" data-v="lotes">← Lotes</button>`;
  out += head(esc(l.modelo || 'Lote'), `<span class="mono">${esc(l.key)}</span>`, `${badge(l.status)} ${vbadge(l.verif)}`,
    `<button class="btn btn-outline" data-act="vlot" data-k="${esc(l.key)}">Verificar lote</button>${canAp ? `<button class="btn btn-primary" data-act="approveLot" data-k="${esc(l.key)}" ${app.canWrite ? '' : 'disabled'}>Aprobar propuesta</button>` : ''}`);
  out += `<div class="card pad"><div class="meta">
    <div><span class="label">Ubicación</span><b>${esc(l.ubic || '—')}</b></div>
    <div><span class="label">Estado CKD</span><b>${esc(l.estadoCKD || '—')}</b></div>
    <div><span class="label">Mes ensamble</span><b>${esc(l.mes || '—')}</b></div>
    <div><span class="label">Fecha programada</span><b>${l.fechaProg ? fmtD(l.fechaProg, true) : esc(l.progTxt || '—')}</b>${l.progSrc === 'RC' ? `<span class="small muted">Rough Cut${l.fechaExcel !== l.fechaProg ? ` · Excel: ${l.fechaExcel ? fmtD(l.fechaExcel) : 'no programado'}` : ''}</span>` : ''}</div>
    <div><span class="label">Revisión</span><b>${fmtD(l.fechaRev)}</b></div>
    <div><span class="label">Verificación física</span><b>${l.verif === 'N/A' ? '—' : esc(l.verif) + (l.verifBy ? ' · ' + esc(nm(l.verifBy)) : '')}</b></div>
  </div>${l.origen === 'APP' ? appLotBox(l) : ''}${l.nota ? `<div class="hr"></div><p class="label">Nota de seguimiento${l.origen === 'APP' ? '' : ' (Excel)'}</p><p style="margin-top:4px">${esc(l.nota)}</p>` : ''}</div>`;

  out += `<div class="section kpis" style="margin-top:24px">
    <div class="card metric"><p class="label">Avance del lote</p><p class="v">${pct(l.avance)}</p><div style="margin:8px 0 4px">${progress(l.avance)}</div><p class="c">${fmtN(l.done)} de ${fmtN(l.realTot)} unidades ingresadas</p></div>
    ${metric('Unidades pendientes', fmtN(l.pend), `${fmtN(l.approved)} aprobadas · ${fmtN(l.proposed)} propuestas`)}
    ${metric('Cobertura', pct(l.cov), 'ingresado + aprobado + propuesto')}
    ${metric('Novedades críticas', fmtN(l.nCrit), l.nCrit ? `${fmtN(l.gap)} unidades sin fuente en inventarios` : 'todas tienen fuente', l.nCrit > 0)}
  </div>`;
  if (l.motosInc) out += `<div class="alert a-danger" style="margin-top:24px"><p class="t">Lote ensamblado con faltantes</p><p class="d">El Excel lo reporta como ENSAMBLADO pero tiene ${fmtN(l.pend)} unidades pendientes: las motos quedaron incompletas. Se mantiene activo para compensar y registrar ingresos.</p></div>`;
  if (l.nCrit && !l.ens) out += `<div class="alert a-danger" style="margin-top:24px"><p class="t">Lote crítico</p><p class="d">${fmtN(l.nCrit)} ${l.nCrit === 1 ? 'novedad no tiene' : 'novedades no tienen'} cómo solucionarse con los inventarios disponibles. Requieren reclamo a Bajaj, reposición o compra.</p></div>`;
  if (l.provisional) out += `<div class="alert a-warn" style="margin-top:24px"><p class="t">Hay líneas por revisar</p><p class="d">Algunos SKU figuran como «PENDIENTE REVISAR» en el Excel y aún no tienen conteo físico. La propuesta usa la cantidad reportada y se considera provisional.</p></div>`;

  out += maestroBanner();
  const L = l.lines.slice().sort((a, b) => b.gap - a.gap || b.need - a.need);
  out += `<div class="section"><div class="section-head"><h2 class="h2">Novedades del Lote</h2><p class="small muted">Propuesta en orden: ${app.fuentes.filter(f => f.on).map(f => SRC_LABEL[f.id]).join(' › ')}</p></div>`;
  out += L.length ? `<div class="tbl"><table><thead><tr><th>SKU</th><th>Origen</th><th class="num">Reportada</th><th class="num">Real</th><th class="num">Ingresada</th><th class="num">Pendiente</th><th>Cobertura</th><th class="num">Brecha</th><th></th></tr></thead><tbody>
    ${L.map(x => {
    const repo = app.base.reposicion[x.sku];
    return `<tr${x.gap ? ' style="box-shadow:inset 4px 0 0 var(--uma-red)"' : ''}><td class="sku">${esc(x.sku)}${descHtml(x.sku, l.modelo)}${repo ? `<div class="small muted" style="font-weight:400;font-family:var(--uma-font)">Bajaj: WO ${esc(repo[0].wo)} · caja ${esc(repo[0].caja)}${repo.length > 1 ? ` (+${repo.length - 1})` : ''}</div>` : ''}</td>
      <td class="small">${x.extra ? '<span class="badge b-rev">Verificación</span>' : `${x.notificado ? 'Notificado' : 'No notificado'}<div class="muted">${esc(x.hallazgo || '—')}</div>`}</td>
      <td class="num">${x.extra ? '—' : fmtN(x.reportada)}</td>
      <td class="num">${x.verified != null ? `<b>${fmtN(x.verified)}</b>` : `<span class="muted">${fmtN(x.real)}</span>`}</td>
      <td class="num">${x.ingresada + x.completado ? fmtN(x.ingresada + x.completado) : '—'}${x.completado ? `<div class="small muted">${fmtN(x.completado)} en app</div>` : ''}</td>
      <td class="num"><b>${fmtN(x.pend)}</b></td>
      <td>${x.pend ? (x.gap ? '<span class="badge b-rech" style="margin-bottom:4px">Crítico</span>' : '') + propChips(x) : '<span class="badge b-apto">Completo</span>'}</td>
      <td class="num" style="${x.gap ? 'color:var(--uma-red);font-weight:700' : ''}">${x.gap ? fmtN(x.gap) : '—'}</td>
      <td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">${x.proposal.length && !l.ens ? `<button class="btn btn-ghost btn-sm" data-act="approveLine" data-k="${esc(l.key)}" data-id="${esc(x.id)}" ${app.canWrite ? '' : 'disabled'}>Aprobar</button>` : ''}${x.pend && !l.ens ? `<button class="btn btn-outline btn-sm" data-act="ingOpen" data-k="${esc(l.key)}" data-id="${esc(x.id)}" ${app.canWrite ? '' : 'disabled'}>Registrar ingreso</button>` : ''}</div></td></tr>
      ${app.ui.ingLine === x.id ? `<tr><td colspan="9" style="background:var(--soft);height:auto">${ingForm(l, x)}</td></tr>` : ''}`;
  }).join('')}</tbody></table></div>` : `<div class="card pad"><p class="muted">Este lote no tiene novedades registradas. Si en la verificación física se encuentran faltantes o sobrantes, regístralos desde «Verificar lote».</p></div>`;
  out += `</div>`;

  /* sobrantes del lote */
  const usos = app.res.approvalsAll.filter(a => a.src === 'LOTES' && a.ref === l.key && !a.cerrada);
  const props = app.res.allLines.flatMap(x => x.proposal.filter(p => p.src === 'LOTES' && p.ref === l.key).map(p => ({ ...p, to: x.key, sku: x.sku })));
  if (l.sob.length) {
    out += `<div class="section"><div class="section-head"><h2 class="h2">Sobrantes de Este Lote</h2><p class="small muted">Disponibles para completar otros lotes</p></div>
    <div class="tbl"><table><thead><tr><th>SKU</th><th class="num">Cantidad</th><th>Origen</th><th>Asignado a</th></tr></thead><tbody>
    ${Object.values(l.sob.reduce((m, s) => { const k = s.sku + (s.extra ? '|x' : ''); m[k] = m[k] ? { ...m[k], qty: m[k].qty + s.qty } : { ...s }; return m; }, {})).map(s => {
      const u2 = usos.filter(a => a.sku === s.sku).map(a => `<span class="chip ok">✓ ${esc(a.key)} <b>${fmtN(a.qty)}</b></span>`)
        .concat(props.filter(p => p.sku === s.sku).map(p => `<span class="chip">${esc(p.to)} <b>${fmtN(p.qty)}</b></span>`));
      return `<tr><td class="sku">${esc(s.sku)}${descHtml(s.sku, l.modelo)}</td><td class="num">${fmtN(s.qty)}</td><td class="small">${s.extra ? 'Verificación física' : 'Excel'}</td><td>${u2.length ? `<div class="chips">${u2.join('')}</div>` : '<span class="muted">Sin asignar</span>'}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
  }

  /* ingresos registrados */
  const ings = (app.st.comp[l.key]?.ingresos || []).slice().reverse();
  if (ings.length) {
    out += `<div class="section"><div class="section-head"><h2 class="h2">Unidades Completadas</h2><p class="small muted">${fmtN(ings.filter(i => !i.cerrada).reduce((t, i) => t + U.num(i.qty), 0))} unidades registradas en la app</p></div><div class="tbl"><table><thead><tr><th>Fecha</th><th>SKU</th><th class="num">Unidades</th><th>Inventario</th><th>Ingresó</th><th>Registró</th><th>Observación</th><th>Estado</th><th></th></tr></thead><tbody>
    ${ings.map(i => `<tr><td class="small" style="white-space:nowrap">${fmtD(i.fecha)}</td><td class="sku">${esc(i.sku)}${descHtml(i.sku, l.modelo)}</td><td class="num"><b>${fmtN(i.qty)}</b></td><td>${esc(srcTxt(i))}${i.src === 'LOTES' && app.res.lots[i.ref]?.ubic ? `<div class="small muted">${esc(app.res.lots[i.ref].ubic)}</div>` : ''}</td>
      <td>${esc(i.quien)}</td><td class="small">${esc(nm(i.by))} · ${fmtTs(i.at)}</td><td class="small">${esc(i.obs || '—')}</td>
      <td>${i.cerrada ? '<span class="badge b-inac">En Excel</span>' : '<span class="badge b-apto">Registrado</span>'}</td>
      <td>${i.cerrada ? '' : `<button class="btn btn-ghost btn-sm" data-act="ingDel" data-k="${esc(l.key)}" data-id="${esc(i.id)}" ${app.canWrite ? '' : 'disabled'}>Quitar</button>`}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }

  /* compensaciones aprobadas */
  const aps = (app.st.comp[l.key]?.approvals || []).slice().reverse();
  if (aps.length) {
    out += `<div class="section"><div class="section-head"><h2 class="h2">Compensaciones Aprobadas</h2></div><div class="tbl"><table><thead><tr><th>SKU</th><th>Fuente</th><th class="num">Cantidad</th><th>Aprobó</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>
    ${aps.map(a => `<tr><td class="sku">${esc(a.sku)}${descHtml(a.sku, l.modelo)}</td><td>${esc(srcTxt(a))}</td><td class="num">${fmtN(a.qty)}</td><td>${esc(nm(a.by))}</td><td class="small">${fmtTs(a.at)}</td>
      <td>${a.cerrada ? '<span class="badge b-inac">Cerrada</span>' : '<span class="badge b-apto">Abierta</span>'}</td>
      <td>${a.cerrada ? '' : `<button class="btn btn-ghost btn-sm" data-act="unapprove" data-k="${esc(l.key)}" data-id="${esc(a.id)}" ${app.canWrite ? '' : 'disabled'}>Quitar</button>`}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  const xl = l.lines.find(x => x.loteSolXls);
  if (xl) out += `<p class="small muted" style="margin-top:24px">Referencia del Excel: «LOTE Solucionable» = ${esc(xl.loteSolXls)}. El Excel evalúa cada SKU contra el inventario total sin descontar lo que ya se asignó a otros lotes; esta app reparte el inventario una sola vez, por prioridad de ensamble.</p>`;
  return out;
}

function ingSources(x) {
  const opts = app.fuentes.map(f => ({ v: f.id, t: SRC_LABEL[f.id] })).concat(Object.entries(EXTRA_SRC).filter(([v]) => v !== 'REPOSICION').map(([v, t]) => ({ v, t })));
  const lotsWith = Object.values(app.res.supply[x.sku] || {}).filter(e => e.src === 'LOTES').map(e => ({ key: e.ref, left: Math.max(0, e.left) }));
  return { opts, lotsWith };
}
function ingDefaults(x) {
  const a = x.approvals[0], p = x.proposal[0];
  const src = a ? a.src : p ? p.src : app.fuentes.find(f => f.on)?.id || 'BUFFER';
  const ref = a ? a.ref : p ? p.ref : '';
  const qty = a ? Math.min(x.pend, x.approvals.filter(y => y.src === a.src && y.ref === a.ref).reduce((t, y) => t + U.num(y.qty), 0)) : p ? p.qty : x.pend;
  const meName = (typeof acct === 'function' && acct()?.nombre) || (app.me ? (app.names[app.me.id] || app.me.name || '') : '');
  return { qty: String(qty), src, ref: ref || '', quien: app.ui.lastQuien || meName, fecha: TODAY, obs: '' };
}
function ingForm(l, x) {
  const f = app.ui.ing, { opts, lotsWith } = ingSources(x);
  return `<div class="stack" style="padding:8px 0"><div class="spread"><div><p class="sub">Registrar unidades completadas · <span class="mono">${esc(x.sku)}</span></p>${descHtml(x.sku, l.modelo)}</div><span class="small muted">Pendiente: <b class="mono">${fmtN(x.pend)}</b></span></div>
    <div class="vrow2" style="grid-template-columns:1fr 1.4fr 1.4fr">
      <label class="field"><span>Unidades *</span><input class="inp mono" type="number" min="1" max="${x.pend}" inputmode="numeric" data-ing="qty" value="${esc(f.qty)}"></label>
      <label class="field"><span>Inventario de origen *</span><select class="inp" data-ing="src">${opts.map(o => `<option value="${o.v}" ${f.src === o.v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>
      ${f.src === 'LOTES' ? `<label class="field"><span>Lote de origen *</span>${lotsWith.length ? `<select class="inp" data-ing="ref"><option value="">—</option>${lotsWith.map(o => `<option value="${esc(o.key)}" ${f.ref === o.key ? 'selected' : ''}>${esc(o.key)} · ${fmtN(o.left)} disp.</option>`).join('')}</select>` : `<input class="inp mono" data-ing="ref" value="${esc(f.ref)}" placeholder="Ej. 5472579L1">`}</label>` : '<span></span>'}
    </div>
    <div class="vrow2" style="grid-template-columns:1.4fr 1fr 1.4fr">
      <label class="field"><span>Ingresó *</span><input class="inp" data-ing="quien" value="${esc(f.quien)}" placeholder="Nombre de quien ingresó las unidades"></label>
      <label class="field"><span>Fecha</span><input class="inp" type="date" data-ing="fecha" value="${esc(f.fecha)}"></label>
      <label class="field"><span>Observación</span><input class="inp" data-ing="obs" value="${esc(f.obs)}" placeholder="Opcional"></label>
    </div>
    <div class="row"><button class="btn btn-primary" data-act="ingSave" data-k="${esc(l.key)}" data-id="${esc(x.id)}">Guardar ingreso</button><button class="btn btn-ghost" data-act="ingCancel">Cancelar</button></div></div>`;
}
function ingSave(key, lineId) {
  const x = app.res.lots[key]?.lines.find(y => y.id === lineId); if (!x) return;
  const f = app.ui.ing, qty = Math.round(U.num(f.qty)), quien = U.str(f.quien);
  if (qty <= 0) return toast('Ingresa una cantidad mayor a cero.');
  if (qty > x.pend) return toast(`La cantidad supera lo pendiente (${fmtN(x.pend)}).`);
  if (!f.src) return toast('Indica el inventario de origen.');
  if (f.src === 'LOTES' && !U.key(f.ref)) return toast('Indica el lote de origen.');
  if (!quien) return toast('Indica quién ingresó las unidades.');
  const src = f.src, ref = src === 'LOTES' ? U.key(f.ref) : '';
  upComp(key, d => {
    d.ingresos = d.ingresos || [];
    d.ingresos.push({ id: rid(), lineId, sku: x.sku, qty, src, ref, quien, fecha: U.date(f.fecha) || TODAY, obs: U.str(f.obs), by: me(), at: Date.now(), cerrada: false });
    // descuenta aprobaciones abiertas de la línea: primero la misma fuente
    let rest = qty;
    const ap = d.approvals.filter(a => a.lineId === lineId && !a.cerrada).sort((a, b) => ((b.src === src && b.ref === ref) ? 1 : 0) - ((a.src === src && a.ref === ref) ? 1 : 0));
    for (const a of ap) { if (rest <= 0) break; const q = Math.min(rest, U.num(a.qty)); a.qty = U.num(a.qty) - q; rest -= q; }
    d.approvals = d.approvals.filter(a => a.cerrada || U.num(a.qty) > 0);
  });
  app.ui.lastQuien = quien; app.ui.ingLine = null; app.ui.ing = null;
  toast(`${fmtN(qty)} unidades registradas`); render();
}

/* ---------- selección múltiple ---------- */
function msLabel(f) { const a = app.ui[f]; return !a.length ? 'Todos' : a.length === 1 ? a[0] : `${a.length} seleccionados`; }
function msSelect(f, label, opts) {
  const sel = app.ui[f], open = app.ui.msOpen === f;
  return `<div class="field ms" data-msw="${f}"><span>${label}</span>
    <button type="button" class="inp ms-btn ${sel.length ? 'on' : ''}" data-act="msToggle" data-msf="${f}" aria-haspopup="listbox" aria-expanded="${open}"><span class="ms-lbl">${esc(msLabel(f))}</span><span aria-hidden="true">▾</span></button>
    <div class="ms-pop" role="listbox" aria-multiselectable="true" ${open ? '' : 'hidden'}>
      <div class="ms-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="msAll" data-msf="${f}">Seleccionar todo</button><button type="button" class="btn btn-ghost btn-sm" data-act="msNone" data-msf="${f}">Limpiar</button></div>
      ${opts.map(o => `<label class="ms-opt"><input type="checkbox" data-live data-ms="${f}" value="${esc(o.v)}" ${sel.includes(o.v) ? 'checked' : ''}><span>${esc(o.t || o.v)}</span><span class="muted mono small" style="margin-left:auto">${o.n}</span></label>`).join('')}
    </div></div>`;
}
function msRefresh(f) {
  const w = document.querySelector(`[data-msw="${f}"]`);
  if (w) { w.querySelector('.ms-lbl').textContent = msLabel(f); w.querySelector('.ms-btn').classList.toggle('on', app.ui[f].length > 0); w.querySelectorAll('input[data-ms]').forEach(c => { c.checked = app.ui[f].includes(c.value); }); }
  if (f.startsWith('bj')) { app.ui.bjAck = false; return render(); }
  const ls = filteredLots();
  const t = document.getElementById('lotsTbl'); if (t) t.innerHTML = lotsTable(ls);
  const c = document.getElementById('lotsCount'); if (c) c.textContent = `${fmtN(ls.length)} lotes con estos filtros`;
}
function msClose() {
  if (!app.ui.msOpen) return;
  const w = document.querySelector(`[data-msw="${app.ui.msOpen}"]`);
  app.ui.msOpen = null;
  if (w) { w.querySelector('.ms-pop').hidden = true; w.querySelector('.ms-btn').setAttribute('aria-expanded', 'false'); }
  render();
}

/* ---------- verificación ---------- */
function vVerif() {
  const u = app.ui, q = u.vq.trim().toUpperCase();
  const ls = app.res.ordered.filter(l => !l.ens && (!u.vPend || l.verif !== 'VERIFICADO') && (!q || l.key.includes(q) || (l.ubic || '').toUpperCase().includes(q) || (l.modelo || '').toUpperCase().includes(q)));
  const act = app.res.ordered.filter(l => !l.ens);
  const done = act.filter(l => l.verif === 'VERIFICADO').length, cur = act.filter(l => l.verif === 'EN CURSO').length;
  let out = head('Piso de planta', 'Verificación Física', `${fmtN(done)} verificados · ${fmtN(cur)} en curso · ${fmtN(act.length - done - cur)} pendientes`);
  out += `<div class="progress" style="margin:-16px 0 24px"><div style="width:${act.length ? done / act.length * 100 : 0}%"></div></div>`;
  out += `<div class="spread" style="margin-bottom:16px"><label class="field" style="flex:1;min-width:220px"><span>Buscar lote o ubicación</span><input class="inp" data-live data-f="vq" value="${esc(u.vq)}" placeholder="Ej. 5472579 o BODEGA 25"></label>
    <div class="seg" role="group" aria-label="Filtro"><button data-act="vpend" data-val="1" aria-pressed="${u.vPend}">Por verificar</button><button data-act="vpend" data-val="0" aria-pressed="${!u.vPend}">Todos</button></div></div>`;
  out += `<div class="tbl" id="verifTbl">${verifTable(ls)}</div>`;
  return out;
}
function verifTable(ls) {
  if (!ls.length) return '<p class="empty">No hay lotes por verificar con este filtro.</p>';
  return `<table><thead><tr><th>Lote</th><th>Ubicación</th><th>Modelo</th><th>Ensamble</th><th class="num">Líneas</th><th>Avance</th><th>Estado</th></tr></thead><tbody>
  ${ls.map(l => `<tr class="click" data-act="vlot" data-k="${esc(l.key)}"><td class="sku">${esc(l.key)}</td><td>${esc(l.ubic || '—')}</td><td class="small">${esc(l.modelo)}</td>
    <td class="small" style="white-space:nowrap">${l.fechaProg ? fmtD(l.fechaProg) : esc(l.mes || '—')}</td><td class="num">${l.lines.filter(x => !x.extra).length}</td>
    <td style="min-width:100px"><div class="progress"><div style="width:${l.verifProg * 100}%"></div></div></td><td>${vbadge(l.verif)}</td></tr>`).join('')}</tbody></table>`;
}
function vVerifLote(key) {
  const l = app.res.lots[key];
  if (!l) return `<button class="back" data-act="go" data-v="verif">← Verificación</button><p class="empty">Lote no encontrado.</p>`;
  const vd = app.st.verif[key] || {};
  const base = l.lines.filter(x => !x.extra);
  const revisados = base.filter(x => x.vinfo).length;
  const ro = app.canWrite ? '' : 'disabled';
  let out = `<button class="back" data-act="go" data-v="verif">← Verificación</button>`;
  out += head(`${esc(l.modelo)} · ${esc(l.ubic || 'sin ubicación')}`, `<span class="mono">${esc(l.key)}</span>`, `${vbadge(l.verif)} <span class="small muted">${revisados} de ${base.length} SKU revisados${vd.by ? ' · ' + esc(nm(vd.by)) + ' ' + fmtTs(vd.at) : ''}</span>`,
    `<button class="btn btn-outline" data-act="lot" data-k="${esc(key)}">Ver compensación</button>`);
  out += `<div class="alert a-info" style="margin-bottom:24px"><p class="t">Cómo registrar</p><p class="d">Para cada SKU anota el faltante real encontrado al contar el lote. «Faltó todo» copia la cantidad reportada y «No faltó» registra cero. Lo que encuentres y no esté en la lista se agrega al final como faltante no reportado o sobrante.</p></div>`;
  out += maestroBanner();
  if (base.length) out += `<div class="vgrid">${base.map(x => vCard(l, x, ro)).join('')}</div>`;
  else out += `<div class="card pad"><p class="muted">El Excel no registra novedades para este lote. Si al verificar encuentras faltantes o sobrantes, agrégalos abajo.</p></div>`;

  const extras = vd.extras || [];
  out += `<div class="section"><div class="section-head"><div><p class="label">Hallazgos fuera de la lista</p><h2 class="h2">Novedades No Reportadas</h2></div></div>`;
  if (extras.length) out += `<div class="tbl" style="margin-bottom:16px"><table><thead><tr><th>Tipo</th><th>SKU</th><th class="num">Cantidad</th><th>Motivo</th><th>Observación</th><th>Registró</th><th></th></tr></thead><tbody>
    ${extras.map(e => `<tr><td>${e.tipo === 'SOBRANTE' ? '<span class="badge b-info">Sobrante</span>' : '<span class="badge b-rech">Faltante</span>'}</td><td class="sku">${esc(e.sku)}${descHtml(e.sku, l.modelo)}</td><td class="num">${fmtN(e.qty)}</td><td class="small">${esc(e.motivo || '—')}</td><td class="small">${esc(e.obs || '—')}</td><td class="small">${esc(nm(e.by))}</td>
      <td><button class="btn btn-ghost btn-sm" data-act="delExtra" data-k="${esc(key)}" data-id="${esc(e.id)}" ${ro}>Quitar</button></td></tr>`).join('')}</tbody></table></div>`;
  out += `<div class="card pad"><div class="vrow2" style="grid-template-columns:1fr 1fr 1fr">
      <label class="field"><span>Tipo</span><select class="inp" id="xTipo"><option value="FALTANTE">Faltante no reportado</option><option value="SOBRANTE">Sobrante encontrado</option></select></label>
      <label class="field"><span>SKU</span><input class="inp mono" id="xSku" data-model="${esc(l.modelo)}" placeholder="Ej. JL171049" autocapitalize="characters"><span id="xDesc"></span></label>
      <label class="field"><span>Cantidad</span><input class="inp mono" id="xQty" type="number" min="0" inputmode="numeric"></label>
    </div><div class="vrow2" style="margin-top:8px">
      <label class="field"><span>Motivo</span><select class="inp" id="xMot"><option value="">—</option>${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
      <label class="field"><span>Observación</span><input class="inp" id="xObs" placeholder="Opcional"></label>
    </div><div class="row" style="margin-top:16px"><button class="btn btn-primary" data-act="addExtra" data-k="${esc(key)}" ${ro}>Agregar novedad</button></div></div></div>`;

  out += `<div class="sticky-foot"><span class="small muted">${revisados} de ${base.length} SKU revisados · ${extras.length} novedades adicionales</span>
    <div class="row">${l.verif === 'VERIFICADO' ? `<button class="btn btn-outline" data-act="vstatus" data-k="${esc(key)}" data-val="EN CURSO" ${ro}>Reabrir verificación</button>` : `<button class="btn btn-primary btn-lg" data-act="vstatus" data-k="${esc(key)}" data-val="VERIFICADO" ${ro}>Marcar lote verificado</button>`}</div></div>`;
  return out;
}
function vCard(l, x, ro) {
  const v = x.vinfo || {};
  const has = v.qty != null && v.qty !== '';
  const diff = has && U.num(v.qty) !== (x.hallazgo === 'NO FALTARON' ? 0 : x.reportada);
  return `<div class="card vcard ${has ? (diff ? 'diff' : 'done') : ''}">
    <div class="vtop"><div><p class="vsku">${esc(x.sku)}</p>${descHtml(x.sku, l.modelo)}<p class="small muted">Reportado ${fmtN(x.reportada)} · ${x.notificado ? 'notificado' : 'no notificado'} · Excel: ${esc(x.hallazgo || '—')}</p></div>${has ? (diff ? '<span class="badge b-rev">Difiere</span>' : '<span class="badge b-apto">Revisado</span>') : ''}</div>
    <div class="vrow">
      <label class="field"><span>Faltante real</span><input class="inp" type="number" min="0" inputmode="numeric" data-vq="${esc(x.id)}" data-k="${esc(l.key)}" value="${has ? esc(v.qty) : ''}" placeholder="${fmtN(x.reportada)}" ${ro}></label>
      <button class="btn btn-outline" data-act="vset" data-k="${esc(l.key)}" data-id="${esc(x.id)}" data-val="${x.reportada}" ${ro}>Faltó todo</button>
      <button class="btn btn-outline" data-act="vset" data-k="${esc(l.key)}" data-id="${esc(x.id)}" data-val="0" ${ro}>No faltó</button>
    </div>
    <div class="vrow2">
      <label class="field"><span>Motivo</span><select class="inp" data-vm="${esc(x.id)}" data-k="${esc(l.key)}" ${ro}><option value="">—</option>${MOTIVOS.map(m => `<option ${v.motivo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field"><span>Observación</span><input class="inp" data-vo="${esc(x.id)}" data-k="${esc(l.key)}" value="${esc(v.obs || '')}" placeholder="Opcional" ${ro}></label>
    </div>
    ${v.by ? `<p class="small muted">${esc(nm(v.by))} · ${fmtTs(v.at)}</p>` : ''}
  </div>`;
}

/* ---------- cruce SKU ---------- */
function vSku() {
  const u = app.ui, q = u.skuQ.trim().toUpperCase();
  const on = app.fuentes.filter(f => f.on).map(f => f.id);
  const all = Object.values(app.res.skus);
  const list = all.filter(s => (!u.skuGap || s.gap > 0) && (!q || s.sku.includes(q) || [...s.modelos].some(m => (m || '').toUpperCase().includes(q))))
    .sort((a, b) => b.gap - a.gap || b.pend - a.pend);
  const gapTot = all.reduce((t, s) => t + s.gap, 0);
  let out = head('Inventarios', 'Cruce por SKU', `${fmtN(all.length)} SKU con faltante pendiente · ${fmtN(all.filter(s => s.gap > 0).length)} con brecha · ${fmtN(gapTot)} unidades sin fuente interna`, `<button class="btn btn-outline" data-act="export">Exportar Excel</button>`);
  out += `<div class="spread" style="margin-bottom:16px"><label class="field" style="flex:1;min-width:220px"><span>Buscar SKU o modelo</span><input class="inp" data-live data-f="skuQ" value="${esc(u.skuQ)}" placeholder="Ej. JL171049"></label>
    <div class="seg" role="group"><button data-act="skugap" data-val="1" aria-pressed="${u.skuGap}">Con brecha</button><button data-act="skugap" data-val="0" aria-pressed="${!u.skuGap}">Todos</button></div></div>`;
  out += maestroBanner();
  out += `<div class="tbl" id="skuTbl">${skuTable(list, on)}</div>`;
  out += `<p class="small muted" style="margin-top:16px">Las columnas muestran el inventario cargado por fuente. «Asignado» suma lo aprobado y lo propuesto; las fuentes desactivadas en Datos no se usan. Brecha = lo que no se cubre con ninguna fuente interna y requiere reclamo o reposición.</p>`;
  return out;
}
function skuTable(list, on) {
  if (!list.length) return '<p class="empty">No hay SKU con estos filtros.</p>';
  const cols = SOURCES.filter(s => s.id !== 'LOTES');
  return `<table><thead><tr><th>SKU</th><th class="num">Lotes</th><th class="num">Pendiente</th><th class="num">Sobr. lotes</th>${cols.map(c => `<th class="num" style="${on.includes(c.id) ? '' : 'opacity:.5'}">${c.label}</th>`).join('')}<th class="num">Asignado</th><th class="num">Brecha</th><th>Reposición Bajaj</th></tr></thead><tbody>
  ${list.map(s => {
    const open = app.ui.skuOpen === s.sku;
    const row = `<tr class="click" data-act="skuopen" data-s="${esc(s.sku)}" aria-expanded="${open}"><td class="sku">${open ? '▾' : '▸'} ${esc(s.sku)}${descHtml(s.sku, [...s.modelos][0])}</td><td class="num">${s.lots.length}</td><td class="num">${fmtN(s.pend)}</td><td class="num">${s.sobLotes ? fmtN(s.sobLotes) : '—'}</td>
      ${cols.map(c => `<td class="num" style="${on.includes(c.id) ? '' : 'opacity:.5'}">${s.inv && s.inv[c.id] ? fmtN(s.inv[c.id]) : '—'}</td>`).join('')}
      <td class="num">${fmtN(s.approved + s.proposed)}</td><td class="num" style="${s.gap ? 'color:var(--uma-red);font-weight:700' : ''}">${s.gap ? fmtN(s.gap) : '—'}</td>
      <td class="small">${s.repo.length ? s.repo.map(r => `WO ${esc(r.wo)} · caja ${esc(r.caja)}`).slice(0, 2).join('<br>') + (s.repo.length > 2 ? ` <span class="muted">+${s.repo.length - 2}</span>` : '') : '<span class="muted">—</span>'}</td></tr>`;
    const det = open ? `<tr><td colspan="${cols.length + 7}" style="background:var(--soft)"><p class="label" style="margin-bottom:8px">Lotes que lo necesitan · por prioridad</p><div class="chips">${s.lots.sort((a, b) => a.prio < b.prio ? -1 : 1).map(x => `<button class="lchip" data-act="lot" data-k="${esc(x.key)}"><span class="dot" style="background:${x.gap ? 'var(--uma-danger)' : x.need ? 'var(--uma-info)' : 'var(--uma-success)'}"></span>${esc(x.key)} · ${fmtN(x.pend)}${x.gap ? ` (brecha ${fmtN(x.gap)})` : ''}</button>`).join('')}</div><p class="small muted" style="margin-top:8px">Modelos: ${esc([...s.modelos].join(', '))}</p></td></tr>` : '';
    return row + det;
  }).join('')}</tbody></table>`;
}

/* ---------- datos ---------- */
function vDatos() {
  const b = app.base, info = app.baseInfo, pi = app.pendingImport;
  let out = head('Configuración', 'Datos y Fuentes', srcLine());
  out += `<div class="grid2"><div class="stack">
    <div class="card pad"><p class="label">Cargar actualización</p><h3 class="h3" style="margin:4px 0 8px">Excel de Seguimiento</h3>
      <p class="small muted" style="margin-bottom:16px">Sube el mismo libro (.xlsx). Se leen las hojas Seguimiento, BD-Faltantes, Sobrantes Aprov y COLOMBIA. Las verificaciones y compensaciones registradas en la app se conservan.</p>
      <input type="file" id="fileIn" accept=".xlsx,.xlsm,.xls" style="display:none">
      <button class="btn btn-primary" data-act="pick" ${app.canWrite ? '' : 'disabled'}>Seleccionar archivo</button>
      ${pi ? `<div class="hr"></div>${pi.error ? `<div class="alert a-danger"><p class="t">No se pudo leer el archivo</p><p class="d">${esc(pi.error)}</p></div>` : `
        <p class="sub">${esc(pi.file)}</p>
        <div class="meta" style="margin:16px 0">${[['Lotes', Object.keys(pi.base.lots).length], ['Líneas de faltante', pi.base.lines.length], ['Sobrantes', pi.base.sobrantes.length], ['SKU con inventario', Object.keys(pi.base.inventario).length]].map(([a, c]) => `<div><span class="label">${a}</span><b class="mono" style="font-size:20px">${fmtN(c)}</b></div>`).join('')}</div>
        ${pi.base.warnings.length ? `<div class="alert a-warn" style="margin-bottom:16px"><p class="t">Revisa antes de publicar</p><p class="d">${pi.base.warnings.map(esc).join('<br>')}</p></div>` : ''}
        <label class="switch" style="margin-bottom:16px"><input type="checkbox" id="closeAp" ${app.ui.closeAp ? 'checked' : ''}><span class="tr"></span><span class="small">Cerrar las compensaciones aprobadas y las unidades completadas registradas en la app (ya están reflejadas en los inventarios y en «Cant. Ingresada» de este Excel)</span></label>
        <div class="row"><button class="btn btn-primary" data-act="publishBase">${app.mode === 'compartido' ? 'Publicar para el equipo' : 'Usar estos datos'}</button><button class="btn btn-ghost" data-act="cancelImport">Cancelar</button></div>`}` : ''}
    </div>
    ${vRoughCut()}
    ${vMaestro()}
    <div class="card pad"><p class="label">Salida</p><h3 class="h3" style="margin:4px 0 8px">Exportar Resultados</h3>
      <p class="small muted" style="margin-bottom:16px">Libro con lotes y su estado, novedades con conteo físico, sobrantes, compensaciones (aprobadas y propuestas) y brechas por SKU.</p>
      <button class="btn btn-outline" data-act="export">Exportar Excel</button></div>
    <div class="card pad"><p class="label">Datos actuales</p><div class="meta" style="margin-top:12px">${[['Lotes', Object.keys(b.lots).length], ['Líneas', b.lines.length], ['Sobrantes', b.sobrantes.length], ['SKU inventario', Object.keys(b.inventario).length], ['SKU con reposición', Object.keys(b.reposicion).length]].map(([a, c]) => `<div><span class="label">${a}</span><b class="mono">${fmtN(c)}</b></div>`).join('')}</div>
      <p class="small muted" style="margin-top:16px">${info.tipo === 'embebido' ? 'Datos incluidos al construir la app.' : 'Datos publicados desde la app.'} Modo de guardado: ${app.mode === 'compartido' ? 'compartido con el equipo' : app.mode === 'local' ? 'solo en este navegador' : esc(app.mode)}.</p></div>
  </div>
  <div class="card pad"><p class="label">Motor de compensación</p><h3 class="h3" style="margin:4px 0 8px">Fuentes y Prioridad</h3>
    <p class="small muted" style="margin-bottom:16px">Los faltantes se cubren en este orden, atendiendo primero los lotes con fecha de ensamble más cercana. Cada unidad se asigna una sola vez. Los cambios aplican para todo el equipo.</p>
    ${app.fuentes.map((f, i) => `<div class="src-row"><span class="mono muted">${i + 1}</span><label class="switch"><input type="checkbox" data-src="${f.id}" ${f.on ? 'checked' : ''} ${app.canWrite ? '' : 'disabled'}><span class="tr"></span><span style="font-weight:700">${SRC_LABEL[f.id]}</span></label>
      <button class="iconbtn" aria-label="Subir prioridad" data-act="srcUp" data-i="${i}" ${i === 0 || !app.canWrite ? 'disabled' : ''}>↑</button><button class="iconbtn" aria-label="Bajar prioridad" data-act="srcDown" data-i="${i}" ${i === app.fuentes.length - 1 || !app.canWrite ? 'disabled' : ''}>↓</button></div>`).join('')}
    <div class="hr"></div>
    <p class="small muted">Origen de cada fuente: sobrantes de lotes (hoja Sobrantes Aprov, bloque SOBRANTES, más los encontrados en la verificación); mezzanine, CKD y buffer (BD-Faltantes); carrusel, homólogas, CEDI y Centro América (Sobrantes Aprov). La reposición anunciada por Bajaj (hoja COLOMBIA) se muestra como referencia y no se descuenta.</p>
  </div></div>`;
  return out;
}


/* ---------- nuevo lote ---------- */
function mesOptions(cur) {
  const set = new Set(Object.values(app.base.lots).map(l => l.mes).filter(Boolean));
  const d = new Date();
  for (let i = -1; i < 9; i++) { const x = new Date(d.getFullYear(), d.getMonth() + i, 1); set.add(MESES[x.getMonth()] + ' ' + x.getFullYear()); }
  if (cur) set.add(cur);
  return [...set].sort((a, b) => (mesStart(a) || '') < (mesStart(b) || '') ? -1 : 1);
}
function vNuevoLote() {
  const f = app.ui.newLot, edit = !!f.editKey;
  const modelos = [...new Set(Object.values(app.base.lots).map(l => l.modelo).filter(Boolean))].sort();
  const estados = [...new Set(['LOTE VIRGEN', 'LOTE INTERVENIDO', 'PEND. DESCARGUE', 'CARRUSEL', ...Object.values(app.base.lots).map(l => l.estadoCKD).filter(Boolean)])];
  const key = U.key(f.wo) + U.key(f.lote);
  let out = `<button class="back" data-act="${edit ? 'lot' : 'go'}" data-v="lotes" data-k="${esc(f.editKey || '')}">← ${edit ? 'Lote' : 'Lotes'}</button>`;
  out += head('Planta CKD', edit ? 'Editar Lote' : 'Nuevo Lote', edit ? 'Los cambios aplican para todo el equipo.' : 'Registra un lote que aún no está en el Excel. Las novedades se cargan después desde la verificación física.');
  out += `<div class="card pad" style="max-width:800px"><div class="stack">
    <div class="vrow2" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>WO *</span><input class="inp mono" data-nl="wo" value="${esc(f.wo)}" inputmode="numeric" placeholder="Ej. 5472760" ${edit ? 'disabled' : ''}></label>
      <label class="field"><span>Lote *</span><input class="inp mono" data-nl="lote" value="${esc(f.lote)}" placeholder="Ej. L1" autocapitalize="characters" ${edit ? 'disabled' : ''}></label>
    </div>
    <p class="small muted">Llave WO/LOTE: <b class="mono" id="nlKey">${esc(key || '—')}</b></p>
    <label class="field"><span>Modelo *</span><input class="inp" data-nl="modelo" list="dlModelos" value="${esc(f.modelo)}" placeholder="Escribe o elige un modelo"><datalist id="dlModelos">${modelos.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
    <div class="vrow2" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Ubicación</span><input class="inp" data-nl="ubic" value="${esc(f.ubic)}" placeholder="Ej. BODEGA 25-ZONA-3"></label>
      <label class="field"><span>Estado CKD</span><select class="inp" data-nl="estadoCKD">${estados.map(e => `<option ${f.estadoCKD === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
    </div>
    <div class="vrow2" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Mes de ensamble *</span><select class="inp" data-nl="mes">${mesOptions(f.mes).map(m => `<option ${f.mes === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="field"><span>Fecha programada</span><input class="inp" type="date" data-nl="fechaProg" value="${esc(f.fechaProg || '')}"></label>
    </div>
    <label class="field"><span>Nota de seguimiento</span><textarea class="inp" data-nl="nota" rows="2" placeholder="Opcional">${esc(f.nota)}</textarea></label>
    <div class="row" style="margin-top:8px">
      <button class="btn btn-primary" data-act="saveLot" data-then="verif">${edit ? 'Guardar cambios' : 'Crear y registrar novedades'}</button>
      ${edit ? '' : '<button class="btn btn-outline" data-act="saveLot" data-then="lot">Crear lote</button>'}
    </div>
  </div></div>`;
  return out;
}
function appLotBox(l) {
  const d = app.st.lotesApp[l.key] || {};
  const hasData = (app.st.verif[l.key] && ((app.st.verif[l.key].extras || []).length || Object.keys(app.st.verif[l.key].lines || {}).length)) || (app.st.comp[l.key]?.approvals || []).length;
  return `<div class="hr"></div><div class="spread"><p class="small muted">Lote creado en la app por ${esc(nm(d.by))} · ${fmtTs(d.at)}. Cuando se agregue al Excel, se tomarán los datos del Excel.</p>
    <div class="row"><button class="btn btn-outline btn-sm" data-act="editLot" data-k="${esc(l.key)}" ${app.canWrite ? '' : 'disabled'}>Editar datos</button>
    ${app.ui.delArm === l.key ? `<button class="btn btn-danger btn-sm" data-act="delLot" data-k="${esc(l.key)}">Confirmar eliminación</button><button class="btn btn-ghost btn-sm" data-act="delCancel">Cancelar</button>` : `<button class="btn btn-ghost btn-sm" data-act="delArm" data-k="${esc(l.key)}" ${app.canWrite ? '' : 'disabled'}>Eliminar lote</button>`}</div></div>
    ${app.ui.delArm === l.key && hasData ? '<p class="small" style="color:var(--uma-red);margin-top:8px">Este lote tiene verificaciones o compensaciones registradas; también se eliminarán.</p>' : ''}`;
}
function saveLot(then) {
  const f = app.ui.newLot, edit = !!f.editKey;
  const wo = U.str(f.wo).replace(/\s+/g, ''), lote = U.key(f.lote);
  const key = edit ? f.editKey : wo + lote;
  if (!edit) {
    if (!/^\d+$/.test(wo)) return toast('El WO debe ser numérico.');
    if (!/^L\d+$/.test(lote)) return toast('El lote debe tener el formato L1, L2, L3…');
    if (app.res.lots[key]) return toast(`El lote ${key} ya existe.`);
  }
  if (!U.str(f.modelo)) return toast('Indica el modelo.');
  if (!f.mes) return toast('Indica el mes de ensamble.');
  const prev = app.st.lotesApp[key] || {};
  const d = {
    key, wo: edit ? prev.wo : wo, lote: edit ? prev.lote : lote, modelo: U.str(f.modelo), ubic: U.str(f.ubic), estadoCKD: U.up(f.estadoCKD),
    mes: U.up(f.mes), fechaProg: U.date(f.fechaProg) || null, progTxt: U.date(f.fechaProg) ? '' : 'NO PROGRAMADO', fechaRev: null, nota: U.str(f.nota),
    by: prev.by || me(), at: prev.at || Date.now(), editBy: edit ? me() : null, editAt: edit ? Date.now() : null,
  };
  app.ui.newLot = null;
  persist('lotesApp', key, d);
  toast(edit ? 'Lote actualizado' : `Lote ${key} creado`);
  if (then === 'verif' && !edit) go('verif', key); else go('lotes', key);
}
async function removeDoc(coll, key) {
  delete app.st[coll][key];
  const path = coll + '/' + key, w = writers[path];
  if (w) { clearTimeout(w.t); w.pending = null; }
  if (app.mode === 'local') return saveLocal();
  if (!app.db) return;
  try { while (w && w.running) await new Promise(r => setTimeout(r, 100)); await app.db.doc(path).delete(); } catch (e) { writeErr(e); }
}
async function delLot(key) {
  app.ui.delArm = null;
  await Promise.all([removeDoc('lotesApp', key), app.st.verif[key] ? removeDoc('verif', key) : null, app.st.comp[key] ? removeDoc('comp', key) : null]);
  recompute(); toast(`Lote ${key} eliminado`); go('lotes');
}

/* ---------- acciones ---------- */
function me() { return app.sess ? 'acc:' + app.sess : (app.me?.id || null); }
function upVerif(key, fn) {
  const d = clone(app.st.verif[key]); d.lines = d.lines || {}; d.extras = d.extras || [];
  fn(d);
  if (!d.status || d.status === 'PENDIENTE') { d.status = 'EN CURSO'; d.by = me(); d.at = Date.now(); }
  persist('verif', key, d);
}
function upComp(key, fn) { const d = clone(app.st.comp[key]); d.approvals = d.approvals || []; fn(d); persist('comp', key, d); }
function approveLines(key, lines) {
  let n = 0;
  upComp(key, d => {
    for (const ln of lines) for (const p of ln.proposal) {
      d.approvals.push({ id: rid(), lineId: ln.id, sku: ln.sku, src: p.src, ref: p.ref, qty: p.qty, by: me(), at: Date.now(), cerrada: false });
      n += p.qty;
    }
  });
  toast(`Compensación aprobada: ${fmtN(n)} unidades`);
}

document.addEventListener('click', e => {
  if (app.ui.msOpen && !e.target.closest(`[data-msw="${app.ui.msOpen}"]`)) msClose();
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act, k = t.dataset.k;
  if (a === 'doLogin' || a === 'login') return doLogin();
  if (a === 'doSetup') return doSetup();
  if (a === 'ownerRecover') { app.lg = { err: '', recover: true }; return render(); }
  if (a === 'ownerRecoverCancel') { app.lg = { err: '' }; return render(); }
  if (a === 'doRecover') return doRecover();
  if (a === 'doChangePwd') return doChangePwd();
  if (a === 'logout') return logout('Sesión cerrada');
  if (a === 'session') { if (!isGated()) go('sesion'); return; }
  if (ACT_PERM[a] && !can(ACT_PERM[a])) return toast('Tu rol no permite esta acción.');
  if (/^u[A-Z]/.test(a)) return onUserAction(a, t);
  if (/^bj[A-Z]/.test(a)) return onBjAction(a, t);
  if (a === 'go') return go(t.dataset.v);
  if (a === 'msToggle') {
    const f = t.dataset.msf;
    app.ui.msOpen = app.ui.msOpen === f ? null : f;
    render();
    const nb = document.querySelector(`.ms-btn[data-msf="${f}"]`); nb && nb.focus();
    return;
  }
  if (a === 'msAll') { const f = t.dataset.msf; app.ui[f] = [...document.querySelectorAll(`input[data-ms="${f}"]`)].map(c => c.value); return msRefresh(f); }
  if (a === 'msNone') { app.ui[t.dataset.msf] = []; return msRefresh(t.dataset.msf); }
  if (a === 'msReset') { Object.assign(app.ui, { fEstado: [], fMes: [], fVerif: [], fModelo: [], q: '', msOpen: null }); return render(); }
  if (a === 'filterStatus') { Object.assign(app.ui, { fEstado: [t.dataset.s], fMes: [], fVerif: [], fModelo: [], q: '', msOpen: null }); return go('lotes'); }
  if (a === 'lot') return go('lotes', k);
  if (a === 'vlot') return go('verif', k);
  if (a === 'skuopen') { app.ui.skuOpen = app.ui.skuOpen === t.dataset.s ? null : t.dataset.s; if (app.ui.view !== 'sku') { app.ui.skuGap = false; app.ui.skuQ = ''; go('sku'); } else render(); return; }
  if (a === 'vpend') { app.ui.vPend = t.dataset.val === '1'; return render(); }
  if (a === 'skugap') { app.ui.skuGap = t.dataset.val === '1'; return render(); }
  if (!app.canWrite && !['export', 'cancelImport'].includes(a)) return toast('No tienes permisos de edición en esta app.');
  if (a === 'newLot') { const m = mesOptions(); const cur = MESES[new Date().getMonth()] + ' ' + new Date().getFullYear(); app.ui.newLot = { wo: '', lote: '', modelo: '', ubic: '', estadoCKD: 'LOTE VIRGEN', mes: m.includes(cur) ? cur : m[0], fechaProg: '', nota: '' }; app.ui.view = 'lotes'; app.ui.lot = null; render(); return window.scrollTo(0, 0); }
  if (a === 'editLot') { const d = app.st.lotesApp[k]; if (!d) return; app.ui.newLot = { ...d, editKey: k }; render(); return window.scrollTo(0, 0); }
  if (a === 'saveLot') return saveLot(t.dataset.then);
  if (a === 'delArm') { app.ui.delArm = k; return render(); }
  if (a === 'delCancel') { app.ui.delArm = null; return render(); }
  if (a === 'delLot') return delLot(k);
  if (a === 'ingOpen') { const x = app.res.lots[k].lines.find(y => y.id === t.dataset.id); app.ui.ingLine = x.id; app.ui.ing = ingDefaults(x); return render(); }
  if (a === 'ingCancel') { app.ui.ingLine = null; app.ui.ing = null; return render(); }
  if (a === 'ingSave') return ingSave(k, t.dataset.id);
  if (a === 'ingDel') { upComp(k, d => { d.ingresos = (d.ingresos || []).filter(i => i.id !== t.dataset.id); }); return toast('Ingreso retirado'); }
  if (a === 'approveLot') { const l = app.res.lots[k]; return approveLines(k, l.lines.filter(x => x.proposal.length)); }
  if (a === 'approveLine') { const l = app.res.lots[k]; return approveLines(k, l.lines.filter(x => x.id === t.dataset.id)); }
  if (a === 'unapprove') { upComp(k, d => { d.approvals = d.approvals.filter(x => x.id !== t.dataset.id); }); return toast('Compensación retirada'); }
  if (a === 'vset') { upVerif(k, d => { const c = d.lines[t.dataset.id] || {}; d.lines[t.dataset.id] = { ...c, qty: Number(t.dataset.val), by: me(), at: Date.now() }; }); return; }
  if (a === 'vstatus') { const d0 = clone(app.st.verif[k]); d0.status = t.dataset.val; d0.by = me(); d0.at = Date.now(); persist('verif', k, d0); toast(t.dataset.val === 'VERIFICADO' ? 'Lote marcado como verificado' : 'Verificación reabierta'); return; }
  if (a === 'addExtra') {
    const sku = U.sku(document.getElementById('xSku').value), qty = U.num(document.getElementById('xQty').value);
    if (!sku || qty <= 0) return toast('Ingresa el SKU y una cantidad mayor a cero.');
    upVerif(k, d => d.extras.push({ id: rid(), tipo: document.getElementById('xTipo').value, sku, qty, motivo: document.getElementById('xMot').value, obs: document.getElementById('xObs').value.trim(), by: me(), at: Date.now() }));
    return toast('Novedad agregada');
  }
  if (a === 'delExtra') { upVerif(k, d => { d.extras = d.extras.filter(x => x.id !== t.dataset.id); }); return; }
  if (a === 'rcPick') return document.getElementById('rcIn').click();
  if (a === 'mpPick') return document.getElementById('mpIn').click();
  if (a === 'rcApply') return rcApply();
  if (a === 'rcCancel') { app.rc = null; return render(); }
  if (a === 'rcClear') return rcClear();
  if (a === 'mpApply') return mpApply();
  if (a === 'mpCancel') { app.mpPending = null; return render(); }
  if (a === 'pick') return document.getElementById('fileIn').click();
  if (a === 'cancelImport') { app.pendingImport = null; return render(); }
  if (a === 'publishBase') return publishBase();
  if (a === 'export') return exportXlsx();
  if (a === 'srcUp' || a === 'srcDown') {
    const i = Number(t.dataset.i), j = a === 'srcUp' ? i - 1 : i + 1;
    const f = app.fuentes.slice(); [f[i], f[j]] = [f[j], f[i]]; return saveFuentes(f);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && app.ui.msOpen) { const b = document.querySelector(`[data-msw="${app.ui.msOpen}"] .ms-btn`); msClose(); const nb = document.querySelector(`[data-msw] .ms-btn[data-msf="${b?.dataset.msf}"]`); nb && nb.focus(); return; } if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); } });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'uQ') return uDoSearch(t.value);
  if (t.id === 'bjPq') { app.ui.bjPq = t.value; const pos = t.selectionStart; render(); const n = document.getElementById('bjPq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.id === 'xSku') { const d = document.getElementById('xDesc'); if (d) d.innerHTML = U.sku(t.value).length >= 5 ? descHtml(U.sku(t.value), t.dataset.model) : ''; return; }
  if (t.dataset.ing && app.ui.ing) { app.ui.ing[t.dataset.ing] = t.value; return; }
  if (t.dataset.nl && app.ui.newLot) { app.ui.newLot[t.dataset.nl] = t.value; const k = document.getElementById('nlKey'); if (k) k.textContent = (U.key(app.ui.newLot.wo) + U.key(app.ui.newLot.lote)) || '—'; return; }
  if (t.dataset.f && t.dataset.live != null) {
    app.ui[t.dataset.f] = t.value;
    if (t.dataset.f === 'q') document.getElementById('lotsTbl').innerHTML = lotsTable(filteredLots());
    else rerenderTableOnly(t.dataset.f);
  }
});
function rerenderTableOnly(f) {
  if (f === 'vq') {
    const u = app.ui, q = u.vq.trim().toUpperCase();
    const ls = app.res.ordered.filter(l => !l.ens && (!u.vPend || l.verif !== 'VERIFICADO') && (!q || l.key.includes(q) || (l.ubic || '').toUpperCase().includes(q) || (l.modelo || '').toUpperCase().includes(q)));
    document.getElementById('verifTbl').innerHTML = verifTable(ls);
  } else if (f === 'skuQ') {
    const q = app.ui.skuQ.trim().toUpperCase();
    const list = Object.values(app.res.skus).filter(s => (!app.ui.skuGap || s.gap > 0) && (!q || s.sku.includes(q) || [...s.modelos].some(m => (m || '').toUpperCase().includes(q)))).sort((a, b) => b.gap - a.gap || b.pend - a.pend);
    document.getElementById('skuTbl').innerHTML = skuTable(list, app.fuentes.filter(x => x.on).map(x => x.id));
  }
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nl && app.ui.newLot) { app.ui.newLot[t.dataset.nl] = t.value; return; }
  if (t.dataset.ms) { const f = t.dataset.ms, set = new Set(app.ui[f]); t.checked ? set.add(t.value) : set.delete(t.value); app.ui[f] = [...set]; return msRefresh(f); }
  if (t.dataset.ing && app.ui.ing) { app.ui.ing[t.dataset.ing] = t.value; if (t.dataset.ing === 'src') { app.ui.ing.ref = ''; t.blur(); render(); } return; }
  if (t.dataset.f && t.dataset.live == null) { app.ui[t.dataset.f] = t.value; t.blur(); return render(); }
  if (t.id === 'fileIn' && t.files[0]) return importFile(t.files[0]);
  if (t.id === 'rcIn' && t.files[0]) { const f = t.files[0]; t.value = ''; return rcFile(f); }
  if (t.id === 'mpIn' && t.files[0]) { const f = t.files[0]; t.value = ''; return mpFile(f); }
  if (t.dataset.rc && app.rc && app.rc.raw) {
    const k = t.dataset.rc;
    if (k === 'sheet') { const g = rcGuess(app.rc.raw[t.value] || []) || { hdr: 0, cWo: -1, cLote: -1, cFecha: -1 }; Object.assign(app.rc, { sheet: t.value, hdr: g.hdr, cWo: g.cWo, cLote: g.cLote, cFecha: g.cFecha, remembered: false }); }
    else if (k === 'hdr') app.rc.hdr = Math.max(0, Math.round(U.num(t.value)) - 1);
    else app.rc[k] = Number(t.value);
    t.blur(); return render();
  }
  if (t.dataset.urole || t.dataset.uactive || t.dataset.uenforce != null) { if (!can('usuarios')) return; return onUserChange(t); }
  for (const [sel, p] of INPUT_PERM) if (t.matches(sel) && !can(p)) return;
  if (t.dataset.bjopt) { app.ui[t.dataset.bjopt] = t.checked; app.ui.bjAck = false; t.blur(); return render(); }
  if (t.id === 'bjAck') { app.ui.bjAck = t.checked; t.blur(); return render(); }
  if (t.id === 'closeAp') { app.ui.closeAp = t.checked; return; }
  if (t.dataset.src) { const f = app.fuentes.map(x => x.id === t.dataset.src ? { ...x, on: t.checked } : x); return saveFuentes(f); }
  if (!app.canWrite) return;
  if (t.dataset.vq) { const v = t.value === '' ? null : Math.max(0, U.num(t.value)); upVerif(t.dataset.k, d => { const c = d.lines[t.dataset.vq] || {}; d.lines[t.dataset.vq] = { ...c, qty: v, by: me(), at: Date.now() }; }); return; }
  if (t.dataset.vm) { upVerif(t.dataset.k, d => { const c = d.lines[t.dataset.vm] || {}; d.lines[t.dataset.vm] = { ...c, motivo: t.value, by: me(), at: Date.now() }; }); return; }
  if (t.dataset.vo) { upVerif(t.dataset.k, d => { const c = d.lines[t.dataset.vo] || {}; d.lines[t.dataset.vo] = { ...c, obs: t.value.trim(), by: me(), at: Date.now() }; }); return; }
});
document.querySelector('.nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b && !isGated()) go(b.dataset.v); });

/* ---------- persistencia ---------- */
const writers = {};
function persist(coll, key, data) {
  app.st[coll][key] = data;
  recompute(); render();
  if (app.mode === 'local') return saveLocal();
  if (!app.db) return;
  const path = coll + '/' + key;
  const w = writers[path] = writers[path] || { running: false, pending: null, t: null };
  w.pending = data; clearTimeout(w.t); w.t = setTimeout(() => flush(path), 400);
}
async function flush(path) {
  const w = writers[path];
  if (!w || w.running || !w.pending) return;
  w.running = true; const d = w.pending; w.pending = null;
  try { await app.db.doc(path).set(d); }
  catch (e) { writeErr(e); }
  w.running = false;
  if (w.pending) flush(path);
}
function writeErr(e) {
  const c = e && e.code;
  if (c === 'invalid_argument') { app.canWrite = false; app.mode = 'lectura'; render(); toast('No tienes permisos para modificar los datos compartidos.'); }
  else if (c === 'quota_exceeded') toast('Se alcanzó el límite de almacenamiento de la app. Exporta y depura datos antiguos.');
  else toast('No se pudo guardar. Revisa la conexión e inténtalo de nuevo.');
}
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ st: app.st, fuentes: app.fuentes, base: app.baseInfo.tipo === 'embebido' ? null : app.base, baseInfo: app.baseInfo })); } catch (e) { /* sin almacenamiento */ }
}
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!s) return;
    if (s.st) app.st = { verif: s.st.verif || {}, comp: s.st.comp || {}, lotesApp: s.st.lotesApp || {}, prog: s.st.prog || null, rcmap: s.st.rcmap || null };
    if (s.fuentes) app.fuentes = normFuentes(s.fuentes);
    if (s.base) { app.base = s.base; app.baseInfo = s.baseInfo; }
  } catch (e) { /* ignorar */ }
}
function normFuentes(list) {
  const out = (list || []).filter(f => SRC_LABEL[f.id]).map(f => ({ id: f.id, on: !!f.on }));
  SOURCES.forEach((s, i) => { if (!out.find(f => f.id === s.id)) out.splice(Math.min(i, out.length), 0, { id: s.id, on: true }); });
  return out;
}
async function saveFuentes(f) {
  app.fuentes = f; recompute(); render();
  if (app.mode === 'local') return saveLocal();
  if (app.db) { try { await app.db.doc('config/fuentes').set({ list: f, by: me(), at: Date.now() }); } catch (e) { writeErr(e); } }
}

function snapColl(coll) {
  app.db.collection(coll).onSnapshot(snap => {
    const next = {};
    for (const d of snap.docs) {
      const w = writers[coll + '/' + d.id];
      next[d.id] = (w && (w.pending || w.running)) ? app.st[coll][d.id] : clone(d.data());
    }
    for (const p in writers) if (p.startsWith(coll + '/') && (writers[p].pending || writers[p].running)) { const k = p.slice(coll.length + 1); next[k] = app.st[coll][k]; }
    app.st[coll] = next; recompute(); rerender();
  }, err => { if (err.code === 'revoked') { app.mode = 'lectura'; app.canWrite = false; rerender(); } });
}
function snapBase() {
  app.db.collection('base').onSnapshot(snap => {
    const docs = {}; for (const d of snap.docs) docs[d.id] = d.data();
    const meta = docs.meta; if (!meta || !meta.version) return;
    try {
      const parts = {};
      for (const p in meta.parts) {
        parts[p] = [];
        for (let i = 0; i < meta.parts[p]; i++) { const c = docs[p + '-' + i]; if (!c || c.version !== meta.version) return; parts[p] = parts[p].concat(c.items); }
      }
      app.base = {
        lots: Object.fromEntries(parts.lots.map(l => [l.key, l])), lines: parts.lines, sobrantes: parts.sob,
        inventario: Object.fromEntries(parts.inv), reposicion: Object.fromEntries(parts.repo), warnings: [],
      };
      app.baseInfo = { tipo: 'publicado', file: meta.file, at: meta.at, by: meta.by };
      recompute(); rerender();
    } catch (e) { /* conservar datos actuales */ }
  });
  app.db.doc('config/fuentes').onSnapshot(s => { if (s.exists && s.data().list) { app.fuentes = normFuentes(clone(s.data().list)); recompute(); rerender(); } });
}

async function resolveNames() {
  if (!app.user) return;
  const ids = new Set();
  const add = id => { if (id && !(id in app.names)) ids.add(id); };
  for (const k in app.st.verif) { const v = app.st.verif[k]; add(v.by); for (const l in v.lines || {}) add(v.lines[l].by); for (const x of v.extras || []) add(x.by); }
  for (const k in app.st.comp) { for (const a of app.st.comp[k].approvals || []) add(a.by); for (const i of app.st.comp[k].ingresos || []) add(i.by); }
  for (const k in app.st.lotesApp) { add(app.st.lotesApp[k].by); add(app.st.lotesApp[k].editBy); }
  add(app.baseInfo.by);
  if (!ids.size) return;
  const arr = [...ids]; arr.forEach(i => app.names[i] = '');
  try { const ps = await app.user.profiles(arr); let ch = false; for (const i of arr) { const n = ps[i]?.name || ''; if (n) { app.names[i] = n; ch = true; } } if (ch) rerender(); } catch (e) { /* ignorar */ }
}

/* ---------- Excel: lectura y exportación ---------- */
let xlsxP = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxP) return xlsxP;
  xlsxP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('No se pudo cargar el lector de Excel.')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}
function d2iso(d) { const x = new Date(d.getTime() + 43200000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
async function importFile(file) {
  try {
    toast('Leyendo archivo…');
    const X = await loadXLSX();
    const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const raw = {};
    for (const n of wb.SheetNames) {
      const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true });
      raw[n] = rows.map(r => r.map(v => v instanceof Date ? d2iso(v) : v));
    }
    const base = parseWorkbook(raw);
    if (!base.lines.length && !Object.keys(base.lots).length) throw new Error('El archivo no tiene las hojas esperadas (Seguimiento, BD-Faltantes).');
    app.pendingImport = { file: file.name, base };
  } catch (e) { app.pendingImport = { file: file.name, error: e.message || String(e) }; }
  render();
}
function chunk(arr) {
  const out = []; let cur = [], size = 0;
  for (const it of arr) { const s = JSON.stringify(it).length + 1; if (cur.length && size + s > 180000) { out.push(cur); cur = []; size = 0; } cur.push(it); size += s; }
  if (cur.length || !out.length) out.push(cur);
  return out;
}
async function publishBase() {
  const pi = app.pendingImport; if (!pi || !pi.base) return;
  const b = pi.base;
  const closeAp = app.ui.closeAp;
  if (closeAp) {
    for (const k in app.st.comp) {
      const d = app.st.comp[k];
      if ((d.approvals || []).some(a => !a.cerrada) || (d.ingresos || []).some(i => !i.cerrada)) persist('comp', k, { ...clone(d), approvals: (d.approvals || []).map(a => ({ ...a, cerrada: true })), ingresos: (d.ingresos || []).map(i => ({ ...i, cerrada: true })) });
    }
  }
  if (app.mode === 'compartido' && app.db) {
    try {
      toast('Publicando datos para el equipo…');
      const version = rid();
      const parts = { lots: chunk(Object.values(b.lots)), lines: chunk(b.lines), sob: chunk(b.sobrantes), inv: chunk(Object.entries(b.inventario)), repo: chunk(Object.entries(b.reposicion)) };
      const counts = {};
      for (const p in parts) { counts[p] = parts[p].length; for (let i = 0; i < parts[p].length; i++) await app.db.doc(`base/${p}-${i}`).set({ version, items: parts[p][i] }); }
      await app.db.doc('base/meta').set({ version, parts: counts, file: pi.file, at: Date.now(), by: me() });
      const old = await app.db.collection('base').get();
      for (const d of old.docs) if (d.id !== 'meta' && d.data().version !== version) { try { await app.db.doc('base/' + d.id).delete(); } catch (e) { /* ignorar */ } }
      toast('Datos publicados para el equipo');
    } catch (e) { return writeErr(e); }
  } else {
    app.base = b; app.baseInfo = { tipo: 'publicado', file: pi.file, at: Date.now(), by: me() };
    saveLocal(); toast('Datos cargados');
  }
  app.base = b; app.baseInfo = { tipo: 'publicado', file: pi.file, at: Date.now(), by: me() };
  app.pendingImport = null; recompute(); render();
}
async function exportXlsx() {
  if (!app.downloads) return toast('La descarga no está disponible en esta vista.');
  let X;
  try { X = await loadXLSX(); } catch (e) { return toast(e.message); }
  const r = app.res;
  const lotsA = [['Lote', 'WO', 'Lote', 'Modelo', 'Ubicación', 'Estado CKD', 'Mes ensamble', 'Fecha programada', 'Fuente fecha', 'Estado app', 'Verificación', 'Verificado por', 'SKU con faltante', 'Unid. pendientes', 'Aprobadas', 'Propuestas', 'Brecha', 'Avance %', 'Cobertura %', 'Novedades críticas', 'Origen']];
  for (const l of r.ordered) lotsA.push([l.key, l.wo, l.lote, l.modelo, l.ubic, l.estadoCKD, l.mes, l.fechaProg || l.progTxt || '', l.progSrc === 'RC' ? 'Rough Cut' : 'Excel', l.status, l.verif, l.verifBy ? nm(l.verifBy) : '', l.nFalt, l.pend, l.approved, l.proposed, l.gap, l.lines.length ? Math.round(l.avance * 1000) / 10 : '', l.lines.length ? Math.round(l.cov * 1000) / 10 : '', l.nCrit, l.origen === 'APP' ? 'App' : 'Excel']);
  const linA = [['Lote', 'SKU', 'Descripción', 'Origen', 'Notificado', 'Hallazgo Excel', 'Reportada', 'Faltante real', 'Conteo físico', 'Motivo', 'Observación', 'Ingresada Excel', 'Completado app', 'Pendiente', 'Aprobado', 'Propuesto', 'Detalle propuesta', 'Brecha', 'Crítico']];
  for (const l of r.ordered) for (const x of l.lines) linA.push([l.key, x.sku, (descFor(x.sku, l.modelo) || {}).es || (descFor(x.sku, l.modelo) || {}).en || '', x.extra ? 'Verificación' : 'Excel', x.notificado ? 'SI' : 'NO', x.hallazgo, x.reportada, x.real, x.verified != null ? 'SI' : 'NO', x.vinfo?.motivo || '', x.vinfo?.obs || '', x.ingresada, x.completado, x.pend, x.approved, x.proposal.reduce((t, p) => t + p.qty, 0), x.proposal.map(p => `${srcTxt(p)}: ${p.qty}`).join('; '), x.gap, x.gap ? 'SI' : 'NO']);
  const sobA = [['Lote', 'SKU', 'Cantidad', 'Origen']];
  for (const l of r.ordered) for (const s of l.sob) sobA.push([l.key, s.sku, s.qty, s.extra ? 'Verificación' : 'Excel']);
  const cmpA = [['Lote destino', 'SKU', 'Fuente', 'Lote origen', 'Ubicación origen', 'Cantidad', 'Estado', 'Por', 'Fecha']];
  for (const a of r.approvalsAll) cmpA.push([a.key, a.sku, SRC_LABEL[a.src], a.ref || '', a.ref ? (r.lots[a.ref]?.ubic || '') : '', a.qty, a.cerrada ? 'Cerrada' : 'Aprobada', nm(a.by), a.at ? new Date(a.at).toLocaleString('es-CO') : '']);
  for (const l of r.ordered) for (const x of l.lines) for (const p of x.proposal) cmpA.push([l.key, x.sku, SRC_LABEL[p.src], p.ref || '', p.ref ? (r.lots[p.ref]?.ubic || '') : '', p.qty, 'Propuesta', '', '']);
  const ingA = [['Lote', 'SKU', 'Unidades', 'Inventario', 'Lote origen', 'Ingresó', 'Fecha', 'Observación', 'Registró', 'Estado']];
  for (const i of r.ingresosAll) ingA.push([i.key, i.sku, i.qty, SRC_LABEL[i.src] || EXTRA_SRC[i.src] || i.src, i.ref || '', i.quien, i.fecha, i.obs || '', nm(i.by), i.cerrada ? 'En Excel' : 'Registrado']);
  const cols = SOURCES.filter(s => s.id !== 'LOTES');
  const skuA = [['SKU', 'Descripción', 'Modelos', 'Lotes afectados', 'Pendiente', 'Sobrantes lotes', ...cols.map(c => c.label), 'Asignado', 'Brecha', 'Reposición Bajaj']];
  for (const s of Object.values(r.skus).sort((a, b) => b.gap - a.gap)) skuA.push([s.sku, (descFor(s.sku, [...s.modelos][0]) || {}).es || '', [...s.modelos].join(', '), s.lots.map(x => x.key).join(', '), s.pend, s.sobLotes, ...cols.map(c => s.inv?.[c.id] || 0), s.approved + s.proposed, s.gap, s.repo.map(x => `WO ${x.wo} caja ${x.caja}`).join('; ')]);
  const wb = X.utils.book_new();
  [['Lotes', lotsA], ['Novedades', linA], ['Sobrantes', sobA], ['Compensaciones', cmpA], ['Unidades completadas', ingA], ['Cruce SKU', skuA]].forEach(([n, a]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(a), n));
  const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
  try { await app.downloads.save({ filename: `Lotes_novedades_${TODAY}.xlsx`, data: new Blob([buf]) }); toast('Archivo exportado'); }
  catch (e) { if (e.code !== 'declined') toast(e.code === 'rate_limited' ? 'Ya hay una descarga en curso.' : 'No se pudo exportar el archivo.'); }
}

/* ---------- arranque ---------- */
function start() {
  app.base = parseWorkbook(RAW);
  recompute(); render();
  initCaps();
}
async function initCaps() {
  if (!window.claude || !window.claude.use) { app.mode = 'local'; app.isAdmin = true; loadLocal(); loadLocalFuentes(); loadLocalCuentas(); loadLocalBajaj(); recompute(); return render(); }
  const [db, user, dl] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('downloads')]);
  app.downloads = dl; app.user = user;
  if (user) {
    try { app.me = await user.me(); } catch (e) { /* */ }
    const cw = await user.can('data.write').catch(() => null); if (cw === false) app.canWrite = false;
    app.isAdmin = !!(app.me?.isOwner || app.me?.canEdit);
    if (app.me?.id) { app.names[app.me.id] = app.me.name || app.names[app.me.id] || ''; app.avatars[app.me.id] = app.me.avatarUrl; if (app.me.email) { app.emails = app.emails || {}; app.emails[app.me.id] = app.me.email; } }
  }
  if (db) {
    app.db = db; app.mode = app.canWrite ? 'compartido' : 'lectura';
    snapColl('verif'); snapColl('comp'); snapColl('lotesApp'); snapBase(); snapFuentes(); snapAcl(); touchPresence(); snapBajaj();
  } else { app.mode = 'local'; app.isAdmin = true; loadLocal(); loadLocalFuentes(); loadLocalCuentas(); loadLocalBajaj(); }
  recompute(); render();
}
