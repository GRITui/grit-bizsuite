/* Grit Taskboard — app/dataClient.js
 *
 * Thin backend-mirror layer for the ops kanban app: auth (register/login/
 * session/logout) plus the ops_tasks sync calls app/opsboard.js uses.
 *
 * 2026-07-21: every other store's mirror (clients/jobs/services/invoices/
 * documents/bookings/followups/portfolio/research/packages/progressLogs),
 * billing checkout/portal, LINE channel connect + booking slots/requests,
 * shop/order requests, and team invite/join/members were removed along
 * with the rest of the Sidekick freelancer persona surface (their backing
 * api/*.js endpoints no longer exist). Local IndexedDB stays every
 * account's source of truth; this file only pushes a best-effort copy of
 * ops_tasks writes to the backend and confirms the bearer session is
 * still valid at boot.
 *
 * No build step, so this loads as a plain classic <script> (not a module)
 * — see index.html, loaded once before app.js. Exposes one global,
 * `SidekickBackend`, rather than free-floating function names, so it reads
 * clearly at every call site in app.js/opsboard.js that this is the
 * backend-mirror layer, not another local helper.
 */
(function () {
  // Same-origin as the app in local dev (python http.server serving app/),
  // cross-origin (GitHub Pages -> Vercel) in production — see lib/cors.js
  // for the allowlist this API enforces on the other end. Overridable via
  // window.__SIDEKICK_API_BASE for tests/local dev against `vercel dev`.
  const API_BASE = window.__SIDEKICK_API_BASE || 'https://sidekickz.vercel.app';
  const TOKEN_KEY = 'sidekick_backend_token';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (!token) return { ok: false, status: 401, data: { error: 'Not signed in to cloud backup' } };
      headers.authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method, headers, body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      return { ok: false, status: 0, data: { error: 'Network error — could not reach the cloud backup service' } };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  async function register({ username, salt, hash, iters, firstName }) {
    const r = await apiFetch('/api/auth-register', { method: 'POST', auth: false, body: { username, salt, hash, iters, firstName } });
    if (r.ok) setToken(r.data.token);
    return r;
  }
  async function login({ username, password }) {
    const r = await apiFetch('/api/auth-login', { method: 'POST', auth: false, body: { username, password } });
    if (r.ok) setToken(r.data.token);
    return r;
  }
  async function session() {
    if (!getToken()) return { ok: false, status: 401, data: {} };
    return apiFetch('/api/auth-session');
  }
  function logout() { clearToken(); }
  function isEnabled() { return !!getToken(); }

  // ── Ops board (Grit BizSuite pivot) ─────────────────────────────────────
  // Screen-scoped sync, not part of a whole-account restore flow — see
  // app/opsboard.js, which pulls fresh from the server every time its
  // screen opens (server wins on `id`) rather than a queued reconciliation.
  //
  // Wire format is snake_case (id/location_id/title/.../assigned_shift),
  // matching api/ops-tasks.js's `select *` pass-through convention —
  // ops_tasks has no separate local-autoincrement-id-vs-cuid split to
  // bridge (its `id` IS the stable identity on both sides, see
  // app/app.js's opsTasks store comment), so a straight snake_case<->
  // camelCase field rename is all that's needed here.
  function toOpsTaskPayload(t) {
    return {
      id: t.id, location_id: t.locationId, title: t.title, description: t.description,
      status: t.status, priority: t.priority, assigned_shift: t.assignedShift,
    };
  }
  function fromOpsTaskRow(row) {
    return {
      id: row.id, locationId: row.location_id, title: row.title, description: row.description,
      status: row.status, priority: row.priority, triggeredBy: row.triggered_by,
      assignedShift: row.assigned_shift, sourceEventId: row.source_event_id,
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    };
  }
  async function opsTasksList(params) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const r = await apiFetch(`/api/ops-tasks${qs}`);
    return { ok: r.ok, status: r.status, rows: r.ok && Array.isArray(r.data.rows) ? r.data.rows.map(fromOpsTaskRow) : [] };
  }
  async function opsTaskCreate(t) {
    const r = await apiFetch('/api/ops-tasks', { method: 'POST', body: toOpsTaskPayload(t) });
    return { ok: r.ok, status: r.status, row: r.ok && r.data.row ? fromOpsTaskRow(r.data.row) : null };
  }
  // `patch` is local-shaped (camelCase) partial fields — only the keys
  // actually present are sent, same "absent fields are left untouched"
  // contract api/ops-tasks.js's PUT implements server-side.
  async function opsTaskUpdate(id, patch) {
    const body = {};
    if ('title' in patch) body.title = patch.title;
    if ('description' in patch) body.description = patch.description;
    if ('priority' in patch) body.priority = patch.priority;
    if ('assignedShift' in patch) body.assigned_shift = patch.assignedShift;
    if ('locationId' in patch) body.location_id = patch.locationId;
    if ('status' in patch) body.status = patch.status;
    const r = await apiFetch(`/api/ops-tasks?id=${encodeURIComponent(id)}`, { method: 'PUT', body });
    return { ok: r.ok, status: r.status, row: r.ok && r.data.row ? fromOpsTaskRow(r.data.row) : null };
  }
  async function opsTaskDelete(id) {
    return apiFetch(`/api/ops-tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  window.SidekickBackend = {
    isEnabled, register, login, session, logout,
    opsTasksList, opsTaskCreate, opsTaskUpdate, opsTaskDelete,
  };
})();
