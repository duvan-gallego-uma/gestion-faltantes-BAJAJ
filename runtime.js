/* ===== Runtime fuera de Claude =====
   Si la página corre publicada en Claude, window.claude ya existe y este archivo no hace nada.
   Si corre servida por el servidor Python (server/), implementa window.claude.use('db' | 'user' | 'downloads')
   contra la API REST /api. Si se abre como archivo suelto, la app queda en modo local (localStorage). */
(function () {
  if (window.claude && window.claude.use) return;
  const API = (window.UMA_API_BASE || '') + '/api';
  const POLL_MS = 2500;
  let healthP = location.protocol === 'file:' ? Promise.resolve(false) : null;
  const health = () => (healthP = healthP || fetch(API + '/health', { cache: 'no-store' }).then(r => r.ok).catch(() => false));

  async function req(method, url, body) {
    const r = await fetch(url, { method, cache: 'no-store', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!r.ok) {
      const e = new Error('HTTP ' + r.status);
      e.code = r.status === 413 ? 'quota_exceeded' : r.status === 403 ? 'invalid_argument' : r.status === 400 ? 'invalid_argument' : 'unavailable';
      throw e;
    }
    return r.json();
  }
  const snapDoc = (id, x) => ({ id, exists: !!x.exists, data: () => (x.exists ? x.data : undefined), metadata: { hasPendingWrites: false, fromCache: false } });

  /* sondeo periódico: cada suscripción consulta la API y avisa solo si hubo cambios */
  const ticks = new Set();
  function poll(fetchFn, cb, errCb) {
    let last = null, stop = false, running = false, timer = null;
    async function tick() {
      if (stop || running) return;
      running = true; clearTimeout(timer);
      try { const { key, snap } = await fetchFn(); if (key !== last) { last = key; cb(snap); } }
      catch (e) { if (errCb) errCb(e); }
      running = false;
      if (!stop) timer = setTimeout(tick, POLL_MS);
    }
    ticks.add(tick); tick();
    return () => { stop = true; clearTimeout(timer); ticks.delete(tick); };
  }
  const kick = () => ticks.forEach(t => t());

  const db = {
    doc(path) {
      const id = path.split('/').pop(), u = API + '/db/doc?path=' + encodeURIComponent(path);
      return {
        id, path,
        async get() { return snapDoc(id, await req('GET', u)); },
        async set(data) { const x = await req('PUT', u, data); kick(); return x; },
        async delete() { await req('DELETE', u); kick(); },
        onSnapshot(cb, err) { return poll(async () => { const x = await req('GET', u); return { key: x.exists + ':' + (x.version || 0), snap: snapDoc(id, x) }; }, cb, err); },
      };
    },
    collection(path) {
      const u = API + '/db/collection?path=' + encodeURIComponent(path);
      const toSnap = x => ({ docs: x.docs.map(d => snapDoc(d.id, { exists: true, data: d.data })), size: x.docs.length, empty: !x.docs.length });
      return {
        async get() { return toSnap(await req('GET', u)); },
        onSnapshot(cb, err) { return poll(async () => { const x = await req('GET', u); return { key: String(x.etag), snap: toSnap(x) }; }, cb, err); },
      };
    },
  };
  const user = {
    me: () => req('GET', API + '/me'),
    can: async () => true,
    profiles: async () => ({}),
    search: async () => [],
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename || 'archivo'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true };
    },
  };
  window.claude = {
    use: async name => {
      if (name === 'downloads') return downloads;
      if (!(await health())) return null;
      if (name === 'db') return db;
      if (name === 'user') return user;
      return null;
    },
  };
})();
