/* Grit Taskboard — opsboard.js  (Grit BizSuite pivot: OPS KANBAN)
 *
 * Loaded AFTER app.js and dataClient.js, so app.js globals (dbAll, dbAdd,
 * dbPut, cuid, nowISO, htmlEsc, attrEsc, toast, switchScreen, currentUser,
 * isGuest) and window.SidekickBackend are all available at call time — same
 * convention every other screen module here (followups.js, research.js,
 * portfolio.js) follows; see this repo's AGENTS.md for the file layout.
 *
 * Public surface (kept on window):
 *   - renderOpsBoard()   — fills #opsboard-body
 *
 * DATA LAYER / SYNC CHOICE: local-first IndexedDB store 'opsTasks' (see
 * app/app.js's openDB() for the store's shape — keyPath 'id', NO
 * autoIncrement, since `id` here IS the stable cuid identity on both sides,
 * unlike every other store's separate local-id/cuid pair). When authed,
 * this file reuses window.SidekickBackend's opsTasksList/opsTaskCreate/
 * opsTaskUpdate calls (added to app/dataClient.js alongside the rest of
 * that file's per-endpoint fetch wrappers) rather than hand-rolling a
 * second fetch/token implementation here — SidekickBackend already owns
 * every other endpoint's auth/error shape, and ops_tasks fits that shape
 * with no bespoke wrinkle that would justify a parallel implementation.
 * Sync is screen-scoped, not part of the account-wide pullAll()/
 * BACKUP_STORES restore flow: renderOpsBoard() pulls fresh from the server
 * every time this screen opens (server wins on a same-id row — pull always
 * overwrites the local copy), and every local create/status-change pushes
 * back best-effort (fire-and-forget, same ".catch(() => {})" posture every
 * other mirrorXSave call site in this app already uses) rather than
 * reconciling a queue of pending local mutations.
 */
'use strict';

(function () {

  const esc = (s) => htmlEsc(s);
  const aesc = (s) => attrEsc(s);
  const STORE = 'opsTasks';

  const COLUMNS = [
    { status: 'todo', label: 'To do' },
    { status: 'in_progress', label: 'In progress' },
    { status: 'review', label: 'Review' },
    { status: 'done', label: 'Done' },
  ];
  const PRIORITIES = ['low', 'normal', 'high'];
  const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High' };
  const TRIGGERED_LABEL = {
    manual: '',
    system_inventory: '📦 Inventory',
    system_pos: '🧾 POS surge',
  };

  function uidNow() { return isGuest ? 'guest' : currentUser.id; }
  function backendReady() {
    return !isGuest && typeof SidekickBackend !== 'undefined' && SidekickBackend.isEnabled();
  }

  function statusIndex(status) {
    const i = COLUMNS.findIndex(c => c.status === status);
    return i < 0 ? 0 : i;
  }

  // ── Sync: pull-on-open (server wins), best-effort push on mutation ──────
  async function pullFromServer() {
    if (!backendReady()) return;
    try {
      const { ok, rows } = await SidekickBackend.opsTasksList();
      if (!ok) return;
      const uid = uidNow();
      for (const row of rows) {
        await dbPut(STORE, { ...row, uid });
      }
    } catch (e) {
      console.error('opsboard pull failed', e);
    }
  }

  async function pushCreate(task) {
    if (!backendReady()) return;
    SidekickBackend.opsTaskCreate(task).catch(() => {});
  }
  async function pushUpdate(id, patch) {
    if (!backendReady()) return;
    SidekickBackend.opsTaskUpdate(id, patch).catch(() => {});
  }

  // ── Render ────────────────────────────────────────────────────────────
  async function renderOpsBoard() {
    const el = document.getElementById('opsboard-body');
    if (!el) return;
    el.innerHTML = `<div class="empty"><p>Loading…</p></div>`;
    await pullFromServer();
    await paint();
  }
  window.renderOpsBoard = renderOpsBoard;

  async function paint() {
    const el = document.getElementById('opsboard-body');
    if (!el) return;
    const uid = uidNow();
    const all = (await dbAll(STORE)).filter(r => r.uid === uid);

    const addBtn = `<button type="button" id="ops-add-btn" class="btn-submit" style="width:100%;margin:0 0 16px">+ New task</button>`;

    const columnsHtml = `<div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;margin:0 -20px;padding-left:20px;padding-right:20px">
      ${COLUMNS.map(col => {
        const cards = all.filter(t => t.status === col.status)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        return `
        <div style="flex:0 0 76%;max-width:300px;min-width:220px">
          <div style="font-size:12px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;padding:0 2px 8px">
            ${esc(col.label)} <span style="color:var(--text4)">(${cards.length})</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;min-height:40px">
            ${cards.length ? cards.map(t => cardHtml(t)).join('') : `<div style="border:1px dashed var(--border-mid);border-radius:var(--radius-sm);padding:14px;text-align:center;color:var(--text4);font-size:12px">No cards</div>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    el.innerHTML = addBtn + columnsHtml;

    const addBtnEl = document.getElementById('ops-add-btn');
    if (addBtnEl) addBtnEl.addEventListener('click', () => openOpsTaskForm());

    el.querySelectorAll('[data-ops-back]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); advanceStatus(btn.getAttribute('data-ops-back'), -1); });
    });
    el.querySelectorAll('[data-ops-fwd]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); advanceStatus(btn.getAttribute('data-ops-fwd'), 1); });
    });
    el.querySelectorAll('[data-ops-del]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(btn.getAttribute('data-ops-del')); });
    });
  }

  function cardHtml(t) {
    const idx = statusIndex(t.status);
    const isHigh = t.priority === 'high';
    // High priority reuses the shared .chip-overdue token (same visually-
    // urgent red the rest of the app already uses for "overdue") so it
    // reads as distinct at a glance; low/normal get a neutral inline chip
    // rather than borrowing a token that implies its own unrelated meaning.
    const priorityChip = isHigh
      ? `<span class="chip chip-overdue">${esc(PRIORITY_LABEL.high)}</span>`
      : `<span class="chip" style="background:color-mix(in srgb,var(--text3) 14%,transparent);color:var(--text3)">${esc(PRIORITY_LABEL[t.priority] || 'Normal')}</span>`;
    const triggeredLabel = TRIGGERED_LABEL[t.triggeredBy] || '';
    const shiftLabel = t.assignedShift ? esc(t.assignedShift) : '';
    return `
      <div class="list-card" style="margin:0;${isHigh ? 'border-color:var(--overdue)' : ''}">
        <div style="padding:12px" data-ops-id="${aesc(t.id)}">
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">${esc(t.title)}</div>
          ${t.description ? `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;line-height:1.4">${esc(t.description)}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">
            ${priorityChip}
            ${triggeredLabel ? `<span style="font-size:11px;color:var(--text3);font-weight:700">${esc(triggeredLabel)}</span>` : ''}
            ${shiftLabel ? `<span style="font-size:11px;color:var(--text3)">🕒 ${shiftLabel}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px">
            <button type="button" data-ops-back="${aesc(t.id)}" ${idx === 0 ? 'disabled' : ''} style="flex:1;padding:8px;border:1px solid var(--border);background:var(--card);color:${idx === 0 ? 'var(--text4)' : 'var(--text3)'};border-radius:var(--radius-sm);font-family:inherit;font-size:12px;font-weight:700;cursor:${idx === 0 ? 'default' : 'pointer'}">‹ Back</button>
            <button type="button" data-ops-fwd="${aesc(t.id)}" ${idx === COLUMNS.length - 1 ? 'disabled' : ''} style="flex:1;padding:8px;border:none;background:${idx === COLUMNS.length - 1 ? 'var(--border)' : 'var(--brand)'};color:${idx === COLUMNS.length - 1 ? 'var(--text4)' : '#fff'};border-radius:var(--radius-sm);font-family:inherit;font-size:12px;font-weight:700;cursor:${idx === COLUMNS.length - 1 ? 'default' : 'pointer'}">${idx === COLUMNS.length - 1 ? 'Done ✓' : 'Advance ›'}</button>
            <button type="button" data-ops-del="${aesc(t.id)}" aria-label="Delete" style="padding:8px 10px;border:1px solid var(--border);background:none;color:var(--text4);border-radius:var(--radius-sm);font-family:inherit;font-size:12px;cursor:pointer">✕</button>
          </div>
        </div>
      </div>`;
  }

  async function advanceStatus(id, delta) {
    const t = await dbGet(STORE, id);
    if (!t || t.uid !== uidNow()) return;
    const idx = statusIndex(t.status);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= COLUMNS.length) return;
    const nextStatus = COLUMNS[nextIdx].status;
    t.status = nextStatus;
    t.updatedAt = nowISO();
    // Entering 'done' stamps completedAt; leaving it for any other column
    // (the '‹ Back' regress affordance) clears it — same rule
    // api/ops-tasks.js's PUT applies server-side.
    t.completedAt = nextStatus === 'done' ? nowISO() : null;
    await dbPut(STORE, t);
    pushUpdate(id, { status: nextStatus });
    await paint();
  }

  async function deleteTask(id) {
    const t = await dbGet(STORE, id);
    if (!t || t.uid !== uidNow()) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;
    await dbDel(STORE, id);
    if (backendReady()) SidekickBackend.opsTaskDelete(id).catch(() => {});
    toast('Task deleted');
    await paint();
  }

  // ── Create form (modal, same shape as research.js's buildFormModal) ────
  function closeModal(idStr) {
    const modalEl = document.getElementById(idStr);
    if (modalEl) modalEl.remove();
  }

  function openOpsTaskForm() {
    closeModal('ops-form-modal');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'ops-form-modal';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="New task">
        <div class="modal-handle"></div>
        <div class="modal-title">New task</div>
        <div class="form-section">
          <div class="field"><label for="ops-title">Title</label>
            <input type="text" id="ops-title" placeholder="e.g. Restock napkins"></div>
          <div class="field"><label for="ops-priority">Priority</label>
            <select id="ops-priority">
              ${PRIORITIES.map(p => `<option value="${p}" ${p === 'normal' ? 'selected' : ''}>${PRIORITY_LABEL[p]}</option>`).join('')}
            </select></div>
          <div class="field"><label for="ops-shift">Assigned shift</label>
            <input type="text" id="ops-shift" placeholder="e.g. Evening, Weekend"></div>
        </div>
        <button type="button" class="btn-submit" id="ops-save">Add task</button>
        <button type="button" class="btn-danger" id="ops-cancel" style="border-color:var(--border-mid);color:var(--text3)">Cancel</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ops-save').addEventListener('click', saveNewTask);
    overlay.querySelector('#ops-cancel').addEventListener('click', () => closeModal('ops-form-modal'));
  }

  async function saveNewTask() {
    const titleEl = document.getElementById('ops-title');
    const title = titleEl.value.trim();
    if (!title) {
      const wrap = titleEl.closest('.field');
      wrap.classList.add('field-invalid');
      toast('Enter a title');
      return;
    }
    const priority = document.getElementById('ops-priority').value;
    const assignedShift = document.getElementById('ops-shift').value.trim() || null;

    const now = nowISO();
    const task = {
      id: cuid(), uid: uidNow(), locationId: null, title, description: null,
      status: 'todo', priority, triggeredBy: 'manual', assignedShift,
      sourceEventId: null, createdAt: now, updatedAt: now, completedAt: null,
    };
    await dbAdd(STORE, task);
    pushCreate(task);
    closeModal('ops-form-modal');
    toast('Task added');
    await paint();
  }

})();
