/* Grit Taskboard — api/auth-sso.js
 *
 * "Continue with Grit BizSuite" — logs into this app using a verified
 * `grit_passport` session (packages/passport/src/session.ts's GritSession)
 * instead of this app's own username/password. Real SSO, not a bridge:
 * unlike the manual `grit_org_links` PUT (api/grit-org-link.js, still used
 * to point an *existing* account at an organization id), this endpoint
 * derives the account itself from the verified identity, so nobody has to
 * register a separate taskboard password at all.
 *
 * Identity resolution (first SSO login for a given grit `userId` always
 * lands the same person on the same taskboard account thereafter, via the
 * new `users.grit_user_id` column):
 *   1. `grit_user_id` already maps to a taskboard account -> log in as it.
 *   2. No account yet, but `grit_org_links.organization_id` already has an
 *      owner (someone from the same organization signed in via SSO before)
 *      -> mint a new shadow account and add it as a `team_members` row
 *      under that owner, so this person lands on the SAME shared board
 *      (existing multi-user infra, lib/teams.js — see its header comment).
 *   3. No account, no existing org link -> this person becomes the org's
 *      first SSO account: mint a shadow account AND the `grit_org_links`
 *      row, so the automated cards api/grit-events.js creates for this
 *      organization_id land on their board from day one.
 *
 * A "shadow" account here means: no password (SSO-only, `password_hash`
 * stays null — the existing LINE-login accounts already establish that a
 * null password_hash is a normal, supported account shape, not an error
 * state — see lib/auth.js's auth-login.js comment on this).
 */
import { db } from '../lib/db.js';
import { signSession } from '../lib/auth.js';
import { verifyPassportToken } from '../lib/passport.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
import { rateLimit } from '../lib/rateLimit.js';

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request) },
  });
}

function mintCuid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'usr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export default async function handler(request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const limited = rateLimit(request, { key: 'auth-sso', limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, request);

  const localSecret = process.env.SESSION_SECRET;
  const gritSecret = process.env.GRIT_SESSION_SECRET;
  if (!localSecret || !gritSecret) return json({ error: 'Server misconfigured' }, 500, request);

  const body = await request.json().catch(() => null);
  const gritToken = body && typeof body.token === 'string' ? body.token : '';
  if (!gritToken) return json({ error: 'Missing token' }, 400, request);

  const grit = await verifyPassportToken(gritToken);
  if (!grit) return json({ error: 'Invalid or expired Grit BizSuite session' }, 401, request);

  const sql = db();
  try {
    let user;

    const [byGritId] = await sql`select cuid, username, first_name from users where grit_user_id = ${grit.userId}`;
    if (byGritId) {
      user = byGritId;
    } else {
      const [existingLink] = await sql`select user_cuid from grit_org_links where organization_id = ${grit.organizationId}`;
      const cuid = mintCuid();
      // Username must be unique; the grit account's own email always is.
      await sql`
        insert into users (cuid, username, grit_user_id, first_name, profile_complete)
        values (${cuid}, ${grit.email.toLowerCase()}, ${grit.userId}, ${grit.name || grit.email}, true)
      `;
      if (existingLink) {
        // Someone from this organization already has a board — join it as
        // a team member instead of starting a separate, empty one.
        await sql`
          insert into team_members (cuid, org_owner_cuid, member_cuid, role)
          values (${mintCuid()}, ${existingLink.user_cuid}, ${cuid}, ${grit.role === 'owner' ? 'admin' : 'staff'})
        `;
      } else {
        // First person from this organization to use Grit Taskboard — they
        // become the board owner, and the org's automated cards
        // (api/grit-events.js) start landing here from now on.
        await sql`insert into grit_org_links (user_cuid, organization_id) values (${cuid}, ${grit.organizationId})`;
      }
      user = { cuid, username: grit.email.toLowerCase(), first_name: grit.name || grit.email };
    }

    const token = await signSession({ userCuid: user.cuid }, localSecret);
    return json({
      token,
      user: { cuid: user.cuid, username: user.username, firstName: user.first_name },
    }, 200, request);
  } catch (err) {
    console.error('auth-sso handler error', err.message);
    return json({ error: 'Could not sign in' }, 502, request);
  }
}

export const config = { runtime: 'edge' };
