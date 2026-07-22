/* Grit Taskboard — lib/teams.js
 *
 * Multi-user data-ownership resolution: a team member's data-owner cuid is
 * resolved to whoever's org they belong to, not their own — every resource
 * table/handler (ops-tasks, grit-org-link) stays scoped by a single
 * `user_cuid` exactly as it always was; this is the one lookup that makes
 * that still correct for a team member acting on a shared org's board.
 *
 * This is core multi-user infra (kept), distinct from the freelancer
 * "Team" persona feature (invite/join/manage-seats UI, billing-gated) that
 * was removed along with the rest of the Sidekick persona surface — the
 * underlying team_members table and resolution functions are still needed
 * by api/ops-tasks.js and api/grit-org-link.js so a staff account can act on
 * the same org's kanban board.
 */

// The effective account whose data a caller should read/write. A plain
// solo account (not a team member of anyone) resolves to itself — this is
// the overwhelmingly common case, so it's one indexed lookup, not a join.
export async function resolveDataOwner(sql, userCuid) {
  const rows = await sql(`select org_owner_cuid from team_members where member_cuid = $1`, [userCuid]);
  return rows.length ? rows[0].org_owner_cuid : userCuid;
}

// True only for an account that is itself the data owner — i.e. not
// resolved through someone else's team_members row.
export async function isAccountOwner(sql, userCuid) {
  const rows = await sql(`select 1 from team_members where member_cuid = $1`, [userCuid]);
  return rows.length === 0;
}

// { orgOwnerCuid, role } if this account is a member of someone else's
// team, else null.
export async function getMembership(sql, userCuid) {
  const rows = await sql(`select org_owner_cuid, role from team_members where member_cuid = $1`, [userCuid]);
  return rows.length ? rows[0] : null;
}
