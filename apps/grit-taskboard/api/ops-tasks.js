/* Grit Taskboard — api/ops-tasks.js
 *
 * Authed CRUD for the ops kanban (ops_tasks table). Same auth/row-scoping
 * shape as lib/crudHandler.js's resource endpoints (bearer session ->
 * resolveDataOwner -> user_cuid, never a client-supplied owner field), but
 * hand-rolled rather than createResourceHandler: this resource needs a few
 * things that factory doesn't support — ?status=/?since= list filters,
 * completed_at bookkeeping on a status transition, and firing a
 * task.completed event (packages/shared-events/src/contracts.ts
 * TaskCompletedData) when a card reaches 'done'. Response rows are raw
 * `select *` output (snake_case columns), same convention every other
 * resource endpoint here uses — app/dataClient.js does the camelCase
 * mapping client-side (fromOpsTaskRow), not this file.
 *
 * `triggered_by` is never client-writable: POST always creates 'manual'
 * cards; 'system_inventory'/'system_pos' cards only ever come from
 * api/grit-events.js's webhook intake.
 */
import { db } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
import { canWrite } from '../lib/entitlements.js';
import { resolveDataOwner } from '../lib/teams.js';
import { rateLimit } from '../lib/rateLimit.js';
import { signGritWebhook } from '../lib/gritEvents.js';

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request) },
  });
}

const STATUSES = new Set(['todo', 'in_progress', 'review', 'done']);
const PRIORITIES = new Set(['low', 'normal', 'high']);

function mintTaskId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'task-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Best-effort, from the caller's point of view (a downed/misconfigured
// subscriber must never fail or roll back the task-completion write
// itself) — but actually awaited here, not truly backgrounded: Vercel
// serverless functions have no guaranteed execution past the point a
// response is returned, so "fire-and-forget" without awaiting would often
// mean "never sent" rather than "sent, response not watched". Callers wrap
// this in .catch(() => {}) as well, for the same reason lib/db.js callers
// elsewhere never let a mirror/notify step's own rejection propagate.
async function emitTaskCompleted(sql, owner, task) {
  const subscribers = (process.env.GRIT_SUBSCRIBERS_TASK_COMPLETED || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!subscribers.length) return;
  const secret = process.env.GRIT_EVENT_WEBHOOK_SECRET;
  if (!secret) return; // nothing safe to sign with — skip silently, same posture as an unset optional env var elsewhere in this app

  const [link] = await sql(`select organization_id from grit_org_links where user_cuid = $1`, [owner]);
  if (!link) return; // no linked org to attribute this event to — skip silently, mirrors api/grit-events.js's own unlinked-org skip

  const envelope = {
    event: 'task.completed',
    timestamp: new Date().toISOString(),
    event_id: mintTaskId(),
    organization_id: link.organization_id,
    data: {
      task_id: task.id,
      location_id: task.location_id,
      title: task.title,
      triggered_by: task.triggered_by,
      assigned_shift: task.assigned_shift,
      created_at: task.created_at,
      completed_at: task.completed_at,
    },
  };
  const rawBody = JSON.stringify(envelope);
  const headers = signGritWebhook(secret, 'task.completed', rawBody);

  await Promise.allSettled(subscribers.map(url =>
    fetch(url, { method: 'POST', headers, body: rawBody }).catch(err => {
      console.error('ops-tasks task.completed delivery failed', url, err.message);
    })
  ));
}

export function createOpsTasksHandler(opts = {}) {
  const getSql = opts.getSql || db;

  return async function handler(request) {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const secret = process.env.SESSION_SECRET;
    if (!secret) return json({ error: 'Server misconfigured' }, 500, request);
    const session = await requireSession(request, secret);
    if (!session) return json({ error: 'Not authenticated' }, 401, request);

    const sql = getSql();
    const owner = await resolveDataOwner(sql, session.userCuid);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    try {
      if (request.method === 'GET') {
        const status = url.searchParams.get('status');
        const since = url.searchParams.get('since');
        if (status && !STATUSES.has(status)) return json({ error: 'Invalid status filter' }, 400, request);
        if (since && Number.isNaN(Date.parse(since))) return json({ error: 'Invalid since filter' }, 400, request);

        const conditions = ['user_cuid = $1'];
        const params = [owner];
        if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
        if (since) { params.push(since); conditions.push(`updated_at >= $${params.length}`); }

        const rows = await sql(
          `select * from ops_tasks where ${conditions.join(' and ')} order by updated_at desc`,
          params
        );
        return json({ rows }, 200, request);
      }

      // Cheap-for-attacker but authenticated write path — a lighter cap
      // than the public/unauthenticated endpoints elsewhere in this app,
      // just enough to blunt a runaway client-side sync loop.
      const limited = rateLimit(request, { key: 'ops-tasks-write', limit: 60, windowMs: 60_000 });
      if (limited) return limited;

      // Same write-lock gate as lib/crudHandler.js — a locked account
      // (trial expired / past_due / canceled) can still read its board,
      // just can't write to it.
      const [user] = await sql(
        `select plan, subscription_status, trial_ends_at from users where cuid = $1`,
        [owner]
      );
      if (!canWrite(user)) {
        return json({ error: 'Subscription required', code: 'locked' }, 402, request);
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.id !== 'string' || !body.id) return json({ error: 'Missing id' }, 400, request);
        if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: 'Missing title' }, 400, request);
        const status = body.status && STATUSES.has(body.status) ? body.status : 'todo';
        const priority = body.priority && PRIORITIES.has(body.priority) ? body.priority : 'normal';
        const completedAt = status === 'done' ? new Date().toISOString() : null;

        const rows = await sql(
          `insert into ops_tasks (id, user_cuid, location_id, title, description, status, priority, triggered_by, assigned_shift, created_at, updated_at, completed_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, now(), now(), $9)
           on conflict (id) do nothing
           returning *`,
          [body.id, owner, body.location_id ?? null, body.title.trim(), body.description ?? null,
            status, priority, body.assigned_shift ?? null, completedAt]
        );
        if (!rows.length) return json({ error: 'A task with this id already exists' }, 409, request);
        const row = rows[0];
        if (row.status === 'done') await emitTaskCompleted(sql, owner, row).catch(() => {});
        return json({ row }, 201, request);
      }

      if (request.method === 'PUT') {
        if (!id) return json({ error: 'Missing ?id=' }, 400, request);
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'Invalid body' }, 400, request);

        const [existing] = await sql(`select * from ops_tasks where id = $1 and user_cuid = $2`, [id, owner]);
        if (!existing) return json({ error: 'Not found' }, 404, request);

        const cols = [];
        const params = [id, owner];
        const set = (col, value) => { params.push(value); cols.push(`${col} = $${params.length}`); };

        if (Object.prototype.hasOwnProperty.call(body, 'title')) {
          if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: 'Invalid title' }, 400, request);
          set('title', body.title.trim());
        }
        if (Object.prototype.hasOwnProperty.call(body, 'description')) set('description', body.description ?? null);
        if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
          if (!PRIORITIES.has(body.priority)) return json({ error: 'Invalid priority' }, 400, request);
          set('priority', body.priority);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'assigned_shift')) set('assigned_shift', body.assigned_shift ?? null);
        if (Object.prototype.hasOwnProperty.call(body, 'location_id')) set('location_id', body.location_id ?? null);

        // Status transitions: entering 'done' stamps completed_at; leaving
        // 'done' for anything else (the kanban's regress affordance) clears
        // it — only when `status` is actually part of THIS update, never as
        // a side effect of an unrelated field edit made after completion.
        let justCompleted = false;
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
          if (!STATUSES.has(body.status)) return json({ error: 'Invalid status' }, 400, request);
          set('status', body.status);
          if (body.status === 'done' && existing.status !== 'done') {
            justCompleted = true;
            set('completed_at', new Date().toISOString());
          } else if (body.status !== 'done' && existing.status === 'done') {
            set('completed_at', null);
          }
        }

        if (!cols.length) return json({ error: 'No updatable fields provided' }, 400, request);
        const rows = await sql(
          `update ops_tasks set ${cols.join(', ')}, updated_at = now()
           where id = $1 and user_cuid = $2
           returning *`,
          params
        );
        if (!rows.length) return json({ error: 'Not found' }, 404, request);
        const row = rows[0];
        if (justCompleted) await emitTaskCompleted(sql, owner, row).catch(() => {});
        return json({ row }, 200, request);
      }

      if (request.method === 'DELETE') {
        if (!id) return json({ error: 'Missing ?id=' }, 400, request);
        const rows = await sql(`delete from ops_tasks where id = $1 and user_cuid = $2 returning id`, [id, owner]);
        if (!rows.length) return json({ error: 'Not found' }, 404, request);
        return json({ deleted: true }, 200, request);
      }

      return json({ error: 'Method not allowed' }, 405, request);
    } catch (err) {
      console.error('ops-tasks handler error', err.message);
      return json({ error: 'Request failed' }, 502, request);
    }
  };
}

export default createOpsTasksHandler();
export const config = { runtime: 'nodejs' };
