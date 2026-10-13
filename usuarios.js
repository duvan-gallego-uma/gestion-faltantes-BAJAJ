/* ===== Cuentas de la app: usuario y contraseña propios ===== */
const ROLES = {
  ADMIN: { label: 'Administrador', b: 'b-rech', d: 'Todo, incluida la creación y gestión de usuarios.' },
  SUPERVISOR: { label: 'Supervisor', b: 'b-info', d: 'Aprueba compensaciones, registra ingresos, verifica, crea lotes y carga datos.' },
  VERIFICADOR: { label: 'Verificador', b: 'b-apto', d: 'Verificación física en piso y registro de unidades ingresadas.' },
  CONSULTA: { label: 'Consulta', b: 'b-inac', d: 'Solo lectura y exportación a Excel.' },
};
const PERMS = {
  ADMIN: ['aprobar', 'ingreso', 'verificar', 'lotes', 'datos', 'usuarios'],
  SUPERVISOR: ['aprobar', 'ingreso', 'verificar', 'lotes', 'datos'],
  VERIFICADOR: ['ingreso', 'verificar'],
  CONSULTA: [],
};
const PERM_LABEL = { aprobar: 'Aprobar compensaciones', ingreso: 'Registrar unidades ingresadas', verificar: 'Verificación física', lotes: 'Crear y editar lotes', datos: 'Cargar Excel, Rough Cut, maestro y fuentes', usuarios: 'Crear y gestionar usuarios' };
const ACT_PERM = {
  approveLot: 'aprobar', approveLine: 'aprobar', unapprove: 'aprobar',
  ingOpen: 'ingreso', ingSave: 'ingreso', ingDel: 'ingreso',
  vset: 'verificar', vstatus: 'verificar', addExtra: 'verificar', delExtra: 'verificar',
  newLot: 'lotes', editLot: 'lotes', saveLot: 'lotes', delArm: 'lotes', delLot: 'lotes',
  pick: 'datos', publishBase: 'datos', rcPick: 'datos', rcApply: 'datos', rcClear: 'datos', mpPick: 'datos', mpApply: 'datos', srcUp: 'datos', srcDown: 'datos',
  uCreate: 'usuarios', uGen: 'usuarios', uReset: 'usuarios', uUnlock: 'usuarios', uDelArm: 'usuarios', uDel: 'usuarios', uDelCancel: 'usuarios', uCredOk: 'usuarios',
};
const INPUT_PERM = [['[data-vq],[data-vm],[data-vo],#xTipo,#xSku,#xQty,#xMot,#xObs', 'verificar'], ['[data-src],[data-rc],#closeAp', 'datos'], ['[data-ing]', 'ingreso'], ['[data-nl]', 'lotes'], ['[data-urole],[data-uactive],#nuNombre,#nuUser,#nuRol,#nuPwd', 'usuarios']];
const SS_KEY = 'uma-lotes-sesion';
const LS_CUENTAS = 'uma-lotes-ckd-v1-cuentas';
const MAX_FALLOS = 5, BLOQUEO_MIN = 5, INACTIVIDAD_MIN = 20, PBKDF2_ITER = 150000;

app.isAdmin = false;            // propietario o editor de la app en Claude (solo para crear el administrador inicial)
app.cuentas = {}; app.cuentasLoaded = false;
app.audit = [];
app.avatars = {}; app.emails = {};
app.sess = (() => { try { const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); return s && s.u ? s.u : null; } catch (e) { return null; } })();
app.lg = { err: '', busy: false };
app.cred = null;                // credenciales recién creadas: se muestran una sola vez
app.lastAct = Date.now();

/* ---------- utilidades ---------- */
const b64e = u8 => btoa(String.fromCharCode(...u8));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPwd(pwd, saltB64, iter) {
  const salt = saltB64 ? b64d(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const it = iter || PBKDF2_ITER;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, key, 256);
  return { salt: b64e(salt), hash: b64e(new Uint8Array(bits)), iter: it };
}
function sameHash(a, b) { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const normUser = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '.');
const validUser = u => /^[a-z0-9._-]{3,30}$/.test(u);
function genPwd() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  while (!/[A-Za-z]/.test(p) || !/\d/.test(p)) p = Array.from(crypto.getRandomValues(new Uint8Array(10)), x => abc[x % abc.length]).join('');
  return p;
}
function pwdProblem(p) {
  if (p.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe combinar letras y números.';
  return '';
}
function acct() { return app.sess ? app.cuentas[app.sess] || null : null; }
function myRole() { const a = acct(); if (!a || a.activo === false) return null; return app.canWrite ? a.rol : 'CONSULTA'; }
function can(p) { const r = myRole(); return !!r && PERMS[r].includes(p); }
function isGated() { const a = acct(); return !a || !myRole() || !!a.debeCambiar; }
function roleBadge(r) { const x = ROLES[r]; return x ? `<span class="badge ${x.b}">${x.label}</span>` : '<span class="badge b-inac">Sin acceso</span>'; }
function acctName(u) { const a = app.cuentas[u]; return a ? a.nombre : u; }
function activeAdmins(except) { return Object.entries(app.cuentas).filter(([u, a]) => u !== except && a.rol === 'ADMIN' && a.activo !== false).length; }
function fillTxt(root) { root.querySelectorAll('[data-txt]').forEach(el => { el.textContent = el.dataset.txt; }); }
function fillLoginIds() { /* compatibilidad */ }
function touchPresence() { /* compatibilidad */ }
function uRequest() { /* compatibilidad */ }
function uDoSearch() { /* compatibilidad */ }
function blurActive() { const a = document.activeElement; if (a && a.blur) a.blur(); }

/* ---------- persistencia ---------- */
function saveLocalCuentas() { try { localStorage.setItem(LS_CUENTAS, JSON.stringify({ cuentas: app.cuentas, audit: app.audit.slice(-200) })); } catch (e) { /* */ } }
async function saveCuenta(u, data) {
  if (data === null) delete app.cuentas[u]; else app.cuentas[u] = data;
  if (app.mode === 'local' || !app.db) return saveLocalCuentas();
  try { if (data === null) await app.db.doc('cuentas/' + u).delete(); else await app.db.doc('cuentas/' + u).set(data); }
  catch (e) { writeErr(e); throw e; }
}
async function audit(accion, target) {
  const e = { at: Date.now(), by: me(), accion, target: target || null };
  if (app.mode === 'local' || !app.db) { app.audit.push(e); return saveLocalCuentas(); }
  try { await app.db.doc('auditoriaApp/' + rid()).set(e); } catch (x) { /* */ }
}
function snapAcl() {
  app.db.collection('cuentas').onSnapshot(snap => {
    const c = {}; for (const d of snap.docs) c[d.id] = clone(d.data());
    app.cuentas = c; app.cuentasLoaded = true; recompute(); rerender();
  }, () => { app.cuentasLoaded = true; rerender(); });
  app.db.collection('auditoriaApp').onSnapshot(snap => { app.audit = snap.docs.map(d => d.data()); rerender(); });
}
function loadLocalCuentas() {
  try { const s = JSON.parse(localStorage.getItem(LS_CUENTAS) || 'null'); if (s) { app.cuentas = s.cuentas || {}; app.audit = s.audit || []; } } catch (e) { /* */ }
  app.cuentasLoaded = true;
}

/* ---------- sesión ---------- */
function setSess(u) { app.sess = u; try { if (u) sessionStorage.setItem(SS_KEY, JSON.stringify({ u, at: Date.now() })); else sessionStorage.removeItem(SS_KEY); } catch (e) { /* */ } }
async function doLogin() {
  const u = normUser(document.getElementById('lgUser')?.value), p = document.getElementById('lgPwd')?.value || '';
  if (!u || !p) { app.lg = { err: 'Ingresa tu usuario y contraseña.', user: u }; blurActive(); return render(); }
  app.lg = { err: '', busy: true, user: u }; blurActive(); render();
  const a = app.cuentas[u];
  const fail = msg => { app.lg = { err: msg, busy: false, user: u }; render(); const el = document.getElementById('lgPwd'); el && el.focus(); };
  if (!a) { await new Promise(r => setTimeout(r, 600)); return fail('Usuario o contraseña incorrectos.'); }
  if (a.bloqueadoHasta && a.bloqueadoHasta > Date.now()) return fail(`Usuario bloqueado por intentos fallidos. Intenta en ${Math.ceil((a.bloqueadoHasta - Date.now()) / 60000)} min o pide a un administrador que lo desbloquee.`);
  if (a.activo === false) return fail('Este usuario está desactivado. Contacta a un administrador.');
  const h = await hashPwd(p, a.salt, a.iter);
  if (!sameHash(h.hash, a.hash)) {
    const n = (a.fallidos || 0) + 1, lock = n >= MAX_FALLOS;
    try { await saveCuenta(u, { ...a, fallidos: lock ? 0 : n, bloqueadoHasta: lock ? Date.now() + BLOQUEO_MIN * 60000 : null }); } catch (e) { /* */ }
    return fail(lock ? `Demasiados intentos. Usuario bloqueado ${BLOQUEO_MIN} minutos.` : `Usuario o contraseña incorrectos. Te quedan ${MAX_FALLOS - n} intentos.`);
  }
  try { await saveCuenta(u, { ...a, fallidos: 0, bloqueadoHasta: null, ultimoIngreso: Date.now(), ingresos: (a.ingresos || 0) + 1 }); } catch (e) { /* solo lectura: continuar */ }
  setSess(u); app.lg = { err: '', busy: false }; app.lastAct = Date.now();
  if (!app.cuentas[u]?.debeCambiar) { toast(`Bienvenido, ${acctName(u)}`); go(app.ui.view === 'usuarios' && !can('usuarios') ? 'tablero' : app.ui.view || 'tablero'); }
  else render();
}
function logout(msg) { setSess(null); app.lg = { err: '', busy: false }; if (app.ui.view === 'sesion') app.ui.view = 'tablero'; blurActive(); render(); window.scrollTo(0, 0); if (msg) toast(msg); }
function login() { return doLogin(); }
async function doChangePwd() {
  const a = acct(); if (!a) return;
  const cur = document.getElementById('cpCur'), p1 = document.getElementById('cpNew').value, p2 = document.getElementById('cpNew2').value;
  const err = m => { app.lg.err = m; blurActive(); render(); };
  if (cur) { const h0 = await hashPwd(cur.value || '', a.salt, a.iter); if (!sameHash(h0.hash, a.hash)) return err('La contraseña actual no es correcta.'); }
  const pr = pwdProblem(p1); if (pr) return err(pr);
  if (p1 !== p2) return err('Las contraseñas no coinciden.');
  if (sameHash((await hashPwd(p1, a.salt, a.iter)).hash, a.hash)) return err('La nueva contraseña debe ser distinta a la actual.');
  const h = await hashPwd(p1);
  try { await saveCuenta(app.sess, { ...a, ...h, debeCambiar: false, cambioAt: Date.now() }); } catch (e) { return; }
  app.lg.err = ''; await audit('Cambió su contraseña', app.sess);
  toast('Contraseña actualizada'); go(app.ui.view === 'sesion' ? 'tablero' : app.ui.view || 'tablero');
}
async function doSetup() {
  const nombre = U.str(document.getElementById('suNombre').value), u = normUser(document.getElementById('suUser').value);
  const p1 = document.getElementById('suPwd').value, p2 = document.getElementById('suPwd2').value;
  const err = m => { app.lg.err = m; blurActive(); render(); };
  if (!nombre) return err('Indica tu nombre completo.');
  if (!validUser(u)) return err('El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
  const pr = pwdProblem(p1); if (pr) return err(pr);
  if (p1 !== p2) return err('Las contraseñas no coinciden.');
  const h = await hashPwd(p1);
  setSess(u);
  try { await saveCuenta(u, { usuario: u, nombre, rol: 'ADMIN', activo: true, ...h, debeCambiar: false, creadoAt: Date.now(), creadoPor: 'acc:' + u, ultimoIngreso: Date.now(), ingresos: 1 }); } catch (e) { setSess(null); return; }
  app.lg.err = ''; await audit('Creó el administrador inicial', u);
  toast('Administrador creado'); go('usuarios');
}

/* ---------- pantallas de ingreso ---------- */
function loginShell(inner) {
  return `<div class="login"><div class="card pad login-card"><p class="label">Grupo UMA · Planta CKD</p><h1 class="h1" style="margin:8px 0 24px">Gestión de Lotes</h1>${inner}</div></div>`;
}
function errBox() { return app.lg.err ? `<div class="alert a-danger" style="margin-bottom:16px" role="alert"><p class="d" style="margin:0">${esc(app.lg.err)}</p></div>` : ''; }
function vIngreso() {
  if (!app.cuentasLoaded) return loginShell('<p class="muted">Cargando…</p>');
  if (!Object.keys(app.cuentas).length) {
    if (!app.isAdmin) return loginShell('<div class="alert a-info"><p class="t">La app aún no tiene usuarios</p><p class="d">El propietario de la app debe crear el primer administrador.</p></div>');
    return loginShell(`<h2 class="h3" style="margin-bottom:8px">Crear Administrador Inicial</h2><p class="small muted" style="margin-bottom:24px">Será el primer usuario de la app. Después crearás las cuentas del equipo desde la sección Usuarios.</p>${errBox()}
      <div class="stack"><label class="field"><span>Nombre completo</span><input class="inp" id="suNombre" autocomplete="name"></label>
      <label class="field"><span>Usuario</span><input class="inp mono" id="suUser" autocomplete="username" autocapitalize="none" placeholder="Ej. duvan.gallego"></label>
      <label class="field"><span>Contraseña</span><input class="inp" type="password" id="suPwd" autocomplete="new-password"></label>
      <label class="field"><span>Confirmar contraseña</span><input class="inp" type="password" id="suPwd2" autocomplete="new-password" data-enter="doSetup"></label>
      <p class="small muted">Mínimo 8 caracteres, con letras y números. No uses la contraseña de tu correo corporativo.</p>
      <button class="btn btn-primary btn-lg" data-act="doSetup" style="width:100%">Crear y entrar</button></div>`);
  }
  if (app.lg.recover && app.isAdmin) return vRecover();
  const a = acct();
  if (a && a.activo === false) setSess(null);
  else if (a && a.debeCambiar) return loginShell(`<h2 class="h3" style="margin-bottom:8px">Crea tu Contraseña</h2><p class="small muted" style="margin-bottom:24px">Hola ${esc(a.nombre)}. Ingresaste con una contraseña temporal; define una propia para continuar.</p>${errBox()}
      <div class="stack"><label class="field"><span>Nueva contraseña</span><input class="inp" type="password" id="cpNew" autocomplete="new-password"></label>
      <label class="field"><span>Confirmar contraseña</span><input class="inp" type="password" id="cpNew2" autocomplete="new-password" data-enter="doChangePwd"></label>
      <p class="small muted">Mínimo 8 caracteres, con letras y números. No uses la contraseña de tu correo corporativo.</p>
      <button class="btn btn-primary btn-lg" data-act="doChangePwd" style="width:100%">Guardar y entrar</button><button class="btn btn-ghost" data-act="logout">Cancelar</button></div>`);
  return loginShell(`${errBox()}<div class="stack">
    <label class="field"><span>Usuario</span><input class="inp mono" id="lgUser" autocomplete="username" autocapitalize="none" value="${esc(app.lg.user || '')}" ${app.lg.busy ? 'disabled' : ''}></label>
    <label class="field"><span>Contraseña</span><input class="inp" type="password" id="lgPwd" autocomplete="current-password" data-enter="doLogin" ${app.lg.busy ? 'disabled' : ''}></label>
    <button class="btn btn-primary btn-lg" data-act="doLogin" style="width:100%" ${app.lg.busy ? 'disabled' : ''}>${app.lg.busy ? 'Validando…' : 'Ingresar'}</button>
    <p class="small muted">¿Olvidaste tu contraseña? Pide a un administrador que la restablezca.</p>
    ${app.isAdmin ? '<button class="btn btn-ghost btn-sm" data-act="ownerRecover" style="align-self:flex-start">Soy el propietario de la app: recuperar acceso</button>' : ''}</div>`);
}
function vRecover() {
  const admins = Object.entries(app.cuentas).filter(([, a]) => a.rol === 'ADMIN').sort((a, b) => a[0].localeCompare(b[0]));
  return loginShell(`<h2 class="h3" style="margin-bottom:8px">Recuperar Acceso</h2><p class="small muted" style="margin-bottom:24px">Como propietario o editor de la app en Claude puedes definir una nueva contraseña para una cuenta de administrador.</p>${errBox()}
    <div class="stack"><label class="field"><span>Cuenta de administrador</span><select class="inp mono" id="rcUser">${admins.map(([u, a]) => `<option value="${esc(u)}">${esc(u)} · ${esc(a.nombre)}</option>`).join('')}</select></label>
    <label class="field"><span>Nueva contraseña</span><input class="inp" type="password" id="rcNew" autocomplete="new-password"></label>
    <label class="field"><span>Confirmar contraseña</span><input class="inp" type="password" id="rcNew2" autocomplete="new-password" data-enter="doRecover"></label>
    <button class="btn btn-primary btn-lg" data-act="doRecover" style="width:100%">Guardar y entrar</button><button class="btn btn-ghost" data-act="ownerRecoverCancel">Volver al ingreso</button></div>`);
}
async function doRecover() {
  if (!app.isAdmin) return;
  const u = document.getElementById('rcUser').value, p1 = document.getElementById('rcNew').value, p2 = document.getElementById('rcNew2').value;
  const err = m => { app.lg.err = m; blurActive(); render(); };
  const c = app.cuentas[u]; if (!c) return err('Selecciona una cuenta.');
  const pr = pwdProblem(p1); if (pr) return err(pr);
  if (p1 !== p2) return err('Las contraseñas no coinciden.');
  const h = await hashPwd(p1);
  try { await saveCuenta(u, { ...c, ...h, activo: true, debeCambiar: false, fallidos: 0, bloqueadoHasta: null, ultimoIngreso: Date.now(), ingresos: (c.ingresos || 0) + 1 }); } catch (e) { return; }
  setSess(u); app.lg = { err: '', busy: false }; app.lastAct = Date.now();
  await audit('Recuperó el acceso como propietario de la app', u);
  toast(`Bienvenido, ${c.nombre}`); go('tablero');
}
function vSesion() {
  const a = acct();
  return head('Mi sesión', esc(a.nombre), `<span class="mono">${esc(a.usuario)}</span> · ${roleBadge(myRole())}`, `<button class="btn btn-outline" data-act="logout">Cerrar sesión</button>`) +
    `<div class="grid2" style="align-items:start"><div class="card pad"><div class="meta">
      <div><span class="label">Último ingreso</span><b>${fmtTs(a.ultimoIngreso)}</b></div><div><span class="label">Ingresos</span><b class="mono">${fmtN(a.ingresos || 0)}</b></div>
      <div><span class="label">Cierre por inactividad</span><b>${INACTIVIDAD_MIN} min</b></div></div><p class="small muted" style="margin-top:16px">${esc(ROLES[myRole()]?.d || '')}</p></div>
    <div class="card pad"><p class="label">Seguridad</p><h3 class="h3" style="margin:4px 0 16px">Cambiar Contraseña</h3>${errBox()}
      <div class="stack"><label class="field"><span>Contraseña actual</span><input class="inp" type="password" id="cpCur" autocomplete="current-password"></label>
      <label class="field"><span>Nueva contraseña</span><input class="inp" type="password" id="cpNew" autocomplete="new-password"></label>
      <label class="field"><span>Confirmar</span><input class="inp" type="password" id="cpNew2" autocomplete="new-password" data-enter="doChangePwd"></label>
      <div class="row"><button class="btn btn-primary" data-act="doChangePwd" ${app.canWrite ? '' : 'disabled'}>Cambiar contraseña</button></div></div></div></div>`;
}

/* ---------- administración ---------- */
function vUsuarios() {
  if (!can('usuarios')) return `<p class="empty">Solo los administradores pueden ver esta sección.</p>`;
  const list = Object.entries(app.cuentas).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre));
  const roleSel = (cur, attrs) => `<select class="inp" ${attrs}>${Object.keys(ROLES).map(r => `<option value="${r}" ${cur === r ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select>`;
  let out = head('Administración', 'Usuarios', `${fmtN(list.length)} usuarios · ${fmtN(list.filter(([, a]) => a.activo !== false).length)} activos`);
  if (app.cred) out += `<div class="alert a-ok" style="margin-bottom:24px"><div class="spread"><div><p class="t">${esc(app.cred.titulo)}</p><p class="d">Entrega estos datos a ${esc(app.cred.nombre)}. Al ingresar, la app le pedirá crear su propia contraseña. No se volverán a mostrar.</p>
      <p style="margin-top:8px">Usuario: <b class="mono">${esc(app.cred.usuario)}</b> · Contraseña temporal: <b class="mono">${esc(app.cred.pwd)}</b></p></div><button class="btn btn-outline btn-sm" data-act="uCredOk">Listo</button></div></div>`;
  out += `<div class="grid2" style="align-items:start"><div class="card pad"><p class="label">Nuevo usuario</p><h3 class="h3" style="margin:4px 0 16px">Crear Usuario</h3>${app.ui.uErr ? `<div class="alert a-danger" style="margin-bottom:16px"><p class="d" style="margin:0">${esc(app.ui.uErr)}</p></div>` : ''}
      <div class="stack"><label class="field"><span>Nombre completo</span><input class="inp" id="nuNombre" placeholder="Ej. Carlos Pérez"></label>
      <div class="vrow2" style="grid-template-columns:1fr 1fr"><label class="field"><span>Usuario</span><input class="inp mono" id="nuUser" autocapitalize="none" placeholder="Ej. carlos.perez"></label>
      <label class="field"><span>Rol</span>${roleSel('VERIFICADOR', 'id="nuRol"')}</label></div>
      <label class="field"><span>Contraseña temporal</span><div class="row" style="flex-wrap:nowrap"><input class="inp mono" id="nuPwd" autocomplete="off" placeholder="Mínimo 8, letras y números"><button class="btn btn-outline" data-act="uGen" type="button">Generar</button></div></label>
      <div class="row"><button class="btn btn-primary" data-act="uCreate">Crear usuario</button></div></div></div>
    <div class="card pad"><p class="label">Referencia</p><h3 class="h3" style="margin:4px 0 16px">Permisos por Rol</h3>
      <div class="tbl" style="border:0"><table><thead><tr><th>Permiso</th>${Object.keys(ROLES).map(r => `<th style="text-align:center">${ROLES[r].label}</th>`).join('')}</tr></thead><tbody>
      ${Object.keys(PERM_LABEL).map(p => `<tr><td class="small">${PERM_LABEL[p]}</td>${Object.keys(ROLES).map(r => `<td style="text-align:center">${PERMS[r].includes(p) ? '<b style="color:var(--uma-success)">✓</b>' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}
      <tr><td class="small">Ver y exportar</td>${Object.keys(ROLES).map(() => '<td style="text-align:center"><b style="color:var(--uma-success)">✓</b></td>').join('')}</tr></tbody></table></div></div></div>`;

  out += `<div class="section"><div class="section-head"><h2 class="h2">Usuarios Registrados</h2></div><div class="tbl"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th>Contraseña</th><th></th></tr></thead><tbody>
    ${list.map(([u, a]) => {
    const self = u === app.sess, locked = a.bloqueadoHasta && a.bloqueadoHasta > Date.now();
    return `<tr><td><b>${esc(a.nombre)}</b>${self ? ' <span class="small muted">(tú)</span>' : ''}</td><td class="mono small">${esc(u)}</td>
      <td style="min-width:160px">${roleSel(a.rol, `data-urole="${esc(u)}" ${self ? 'disabled title="No puedes cambiar tu propio rol"' : ''}`)}</td>
      <td><label class="switch"><input type="checkbox" data-uactive="${esc(u)}" ${a.activo !== false ? 'checked' : ''} ${self ? 'disabled' : ''}><span class="tr"></span><span class="small">${a.activo !== false ? 'Activo' : 'Inactivo'}</span></label></td>
      <td class="small">${a.ultimoIngreso ? fmtTs(a.ultimoIngreso) : '<span class="muted">Nunca</span>'}${a.ingresos ? `<div class="muted">${fmtN(a.ingresos)} ingresos</div>` : ''}</td>
      <td>${locked ? '<span class="badge b-rech">Bloqueado</span>' : a.debeCambiar ? '<span class="badge b-rev">Temporal</span>' : '<span class="badge b-apto">Propia</span>'}</td>
      <td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">${locked ? `<button class="btn btn-ghost btn-sm" data-act="uUnlock" data-id="${esc(u)}">Desbloquear</button>` : ''}
        ${self ? '' : `<button class="btn btn-ghost btn-sm" data-act="uReset" data-id="${esc(u)}">Restablecer contraseña</button>`}
        ${self ? '' : app.ui.uDelArm === u ? `<button class="btn btn-danger btn-sm" data-act="uDel" data-id="${esc(u)}">Confirmar</button><button class="btn btn-ghost btn-sm" data-act="uDelCancel">Cancelar</button>` : `<button class="btn btn-ghost btn-sm" data-act="uDelArm" data-id="${esc(u)}">Eliminar</button>`}</div></td></tr>`;
  }).join('')}</tbody></table></div></div>`;

  const log = app.audit.slice().sort((a, b) => b.at - a.at).slice(0, 60);
  out += `<div class="section"><div class="section-head"><h2 class="h2">Registro de Cambios</h2><p class="small muted">Últimas 60 acciones sobre usuarios</p></div>`;
  out += log.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Realizó</th><th>Acción</th><th>Usuario</th></tr></thead><tbody>
    ${log.map(e => `<tr><td class="small" style="white-space:nowrap">${fmtTs(e.at)}</td><td class="small">${esc(nm(e.by))}</td><td class="small">${esc(e.accion)}</td><td class="small">${e.target ? esc(acctName(e.target)) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card pad"><p class="muted">Sin cambios registrados.</p></div>';
  return out + `</div>`;
}
async function onUserAction(a, t) {
  const u = t.dataset.id;
  if (a === 'uGen') { const el = document.getElementById('nuPwd'); if (el) el.value = genPwd(); return; }
  if (a === 'uCredOk') { app.cred = null; return render(); }
  if (a === 'uCreate') {
    const nombre = U.str(document.getElementById('nuNombre').value), user = normUser(document.getElementById('nuUser').value);
    const rol = document.getElementById('nuRol').value, pwd = document.getElementById('nuPwd').value.trim();
    const err = m => { app.ui.uErr = m; blurActive(); render(); };
    if (!nombre) return err('Indica el nombre completo.');
    if (!validUser(user)) return err('El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
    if (app.cuentas[user]) return err(`El usuario «${user}» ya existe.`);
    const pr = pwdProblem(pwd); if (pr) return err(pr);
    const h = await hashPwd(pwd);
    try { await saveCuenta(user, { usuario: user, nombre, rol, activo: true, ...h, debeCambiar: true, creadoAt: Date.now(), creadoPor: me() }); } catch (e) { return; }
    app.ui.uErr = ''; app.cred = { titulo: 'Usuario creado', nombre, usuario: user, pwd };
    await audit(`Creó el usuario como ${ROLES[rol].label}`, user); blurActive(); render(); window.scrollTo(0, 0); return;
  }
  if (a === 'uReset') {
    const c = app.cuentas[u]; if (!c) return;
    const pwd = genPwd(), h = await hashPwd(pwd);
    try { await saveCuenta(u, { ...c, ...h, debeCambiar: true, fallidos: 0, bloqueadoHasta: null }); } catch (e) { return; }
    app.cred = { titulo: 'Contraseña restablecida', nombre: c.nombre, usuario: u, pwd };
    await audit('Restableció la contraseña', u); render(); window.scrollTo(0, 0); return;
  }
  if (a === 'uUnlock') { const c = app.cuentas[u]; try { await saveCuenta(u, { ...c, fallidos: 0, bloqueadoHasta: null }); } catch (e) { return; } await audit('Desbloqueó el usuario', u); render(); return toast('Usuario desbloqueado'); }
  if (a === 'uDelArm') { app.ui.uDelArm = u; return render(); }
  if (a === 'uDelCancel') { app.ui.uDelArm = null; return render(); }
  if (a === 'uDel') {
    const c = app.cuentas[u]; if (!c) return;
    if (c.rol === 'ADMIN' && activeAdmins(u) < 1) return toast('Debe quedar al menos un administrador activo.');
    app.ui.uDelArm = null;
    try { await saveCuenta(u, null); } catch (e) { return; }
    await audit(`Eliminó el usuario ${c.nombre}`, u); render(); return toast('Usuario eliminado');
  }
}
async function onUserChange(t) {
  if (t.dataset.urole) {
    const u = t.dataset.urole, c = app.cuentas[u]; if (!c) return;
    if (c.rol === 'ADMIN' && t.value !== 'ADMIN' && activeAdmins(u) < 1) { toast('Debe quedar al menos un administrador activo.'); return render(); }
    try { await saveCuenta(u, { ...c, rol: t.value }); } catch (e) { return; }
    await audit(`Cambió el rol a ${ROLES[t.value].label}`, u); blurActive(); render(); return toast('Rol actualizado');
  }
  if (t.dataset.uactive) {
    const u = t.dataset.uactive, c = app.cuentas[u]; if (!c) return;
    if (!t.checked && c.rol === 'ADMIN' && activeAdmins(u) < 1) { toast('Debe quedar al menos un administrador activo.'); return render(); }
    try { await saveCuenta(u, { ...c, activo: t.checked }); } catch (e) { return; }
    await audit(t.checked ? 'Activó el usuario' : 'Desactivó el usuario', u); blurActive(); render(); return toast(t.checked ? 'Usuario activado' : 'Usuario desactivado');
  }
}

/* ---------- permisos en pantalla, encabezado e inactividad ---------- */
function applyPerms(root) {
  root.querySelectorAll('[data-act]').forEach(el => { const p = ACT_PERM[el.dataset.act]; if (p && !can(p) && 'disabled' in el) { el.disabled = true; el.title = 'Tu rol no permite esta acción'; } });
  for (const [sel, p] of INPUT_PERM) if (!can(p)) root.querySelectorAll(sel).forEach(el => { el.disabled = true; });
  const nu = document.getElementById('navUsers'); if (nu) nu.hidden = !can('usuarios');
  const chip = document.getElementById('userChip');
  if (chip) {
    const a = acct();
    chip.innerHTML = `<i class="avatar"></i><span><b></b><small>${esc(ROLES[myRole()]?.label || '')}</small></span>`;
    chip.querySelector('.avatar').textContent = (a?.nombre || '?').split(/\s+/).map(x => x[0] || '').slice(0, 2).join('').toUpperCase();
    chip.querySelector('b').textContent = a?.nombre || '';
  }
}
['click', 'keydown', 'input', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { app.lastAct = Date.now(); }, { passive: true, capture: true }));
setInterval(() => { if (app.sess && Date.now() - app.lastAct > INACTIVIDAD_MIN * 60000) logout(`Sesión cerrada por ${INACTIVIDAD_MIN} minutos de inactividad`); }, 30000);
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.enter) return;
  e.preventDefault(); const f = e.target.dataset.enter;
  if (f === 'doRecover') doRecover();
  if (f === 'doLogin') doLogin(); else if (f === 'doSetup') doSetup(); else if (f === 'doChangePwd') doChangePwd();
});
