-- Grit Taskboard — core app schema
--
-- `cuid` is the real primary key on `users`, matching this app's existing
-- client-generated id convention. Run this once against the Neon database
-- (or through api/admin-migrate.js) — there is no separate migration
-- runner in this project.
--
-- 2026-07-21: the freelancer persona schema (clients/jobs/services/
-- invoices/documents/app_bookings/followups/portfolio/research/packages/
-- progress_logs/settings/line_channels/availability_slots/bookings/
-- order_requests — the Sidekick booking/CRM/invoicing/LINE product) has
-- been dropped along with the rest of the persona app surface. This app is
-- now solely the ops kanban board: `users` (auth), `team_members`
-- (multi-user data-ownership resolution for a shared org's board),
-- `ops_tasks` (the kanban cards), and `grit_org_links` (mapping this
-- account to a Grit BizSuite organization id for event-driven cards).

create table if not exists users (
  cuid              text primary key,
  username          text not null unique,
  password_hash     text,
  password_salt     text,
  password_iters    int,
  first_name        text,
  -- Vestigial: LINE login (api/line-login-*.js) was removed along with the
  -- rest of the freelancer persona surface. Columns kept nullable/unused
  -- rather than dropped, so no pre-existing row's data is destroyed.
  line_sub          text unique,
  line_picture      text,
  profile_complete  boolean not null default true,
  -- Null until the one-time local->server upload (api/migrate-upload.js)
  -- has run for this account. A later cutover phase must not let an
  -- unmigrated account start reading from the server before this is set.
  migrated_at       timestamptz,
  created_at        timestamptz not null default now(),
  -- ─── Subscription (Phase 0, 2026-07-14) ──────────────────────────────
  -- 'basic' | 'pro' | 'team' — Team billing (seats/orgs) is Phase 2, not
  -- built yet; this column exists now so Phase 1 gating has somewhere to
  -- read from. subscription_status: 'trialing' | 'active' | 'past_due' |
  -- 'canceled'. Default is 'active' with no trial clock (not 'trialing')
  -- specifically so this ALTER grandfathers every pre-existing account —
  -- see the trial-fields default below, and lib/entitlements.js, for why
  -- that matters: nobody using the app before this shipped should hit a
  -- surprise lock. New registrations (api/auth-register.js) explicitly
  -- override both to start a real 15-day trial instead of relying on this
  -- default. trial_ends_at is the ONLY thing lib/entitlements.js checks
  -- against the clock — a 'trialing' row with a null trial_ends_at (should
  -- never happen post-registration, but is possible if this default is
  -- ever hit some other way) is treated as never-expiring, not locked.
  plan                  text not null default 'basic' check (plan in ('basic','pro','team')),
  subscription_status   text not null default 'active' check (subscription_status in ('trialing','active','past_due','canceled')),
  trial_ends_at         timestamptz,
  stripe_customer_id    text,
  stripe_subscription_id text,
  current_period_end    timestamptz,
  -- ─── Team seats (Phase 2, 2026-07-15) ────────────────────────────────
  -- Purchased seat count for a 'team'-plan account, INCLUDING the owner
  -- (so "2 seats" = the owner + 1 invited member) — synced from Stripe's
  -- subscription item quantity by api/stripe-webhook.js. Null/meaningless
  -- for non-team plans. See the TEAM section further down for the actual
  -- membership model — this column only tracks capacity, not membership.
  team_seats            integer
);

-- Idempotent by design (`add column if not exists`) so this can be re-run
-- safely against the already-live production table — same by-hand
-- apply-once convention as the rest of this file (no migration runner
-- exists in this project). A fresh `create table` above already includes
-- these columns for anyone standing up the schema from scratch; this
-- block only matters for the existing deployed database.
alter table users add column if not exists plan text not null default 'basic';
alter table users add column if not exists subscription_status text not null default 'active';
alter table users add column if not exists trial_ends_at timestamptz;
alter table users add column if not exists stripe_customer_id text;
alter table users add column if not exists stripe_subscription_id text;
alter table users add column if not exists current_period_end timestamptz;
alter table users add column if not exists team_seats integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_plan_check') then
    alter table users add constraint users_plan_check check (plan in ('basic','pro','team'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_subscription_status_check') then
    alter table users add constraint users_subscription_status_check check (subscription_status in ('trialing','active','past_due','canceled'));
  end if;
end $$;

-- ─── TEAM: multi-user data-ownership resolution ────────────────────────
-- Shared-single-identity model, not per-resource org scoping: a team is
-- just one account (the "owner") plus a set of *other* accounts who've
-- been granted access to operate on the owner's data — used so a staff
-- account can act on the same org's ops kanban board. `ops_tasks` (and any
-- future resource table) stays scoped by a single `user_cuid` owner
-- column; what resolves an *effective* data-owner cuid for the caller
-- before running any query is lib/crudHandler.js / lib/teams.js's
-- resolveDataOwner(): a plain solo account's effective owner is itself; a
-- team member's effective owner is whoever's `org_owner_cuid` their row
-- here points to.
--
-- The owner is never a row in this table (implicit: whoever `org_owner_cuid`
-- equals). Only 'admin'/'staff' are ever stored here — a role of 'owner'
-- would be redundant and just another state to keep in sync.
--
-- `member_cuid` is UNIQUE on its own (not just the pair) — membership is
-- kept to exactly one org per account, matching "you work for one
-- business, not several simultaneously." Prevents needing
-- resolveDataOwner() to handle "which of several orgs" ambiguity.
create table if not exists team_members (
  cuid              text primary key,
  org_owner_cuid    text not null references users(cuid) on delete cascade,
  member_cuid       text not null unique references users(cuid) on delete cascade,
  role              text not null check (role in ('admin', 'staff')),
  joined_at         timestamptz not null default now()
);

create index if not exists idx_team_members_owner on team_members(org_owner_cuid);

-- ─── OPS TASKBOARD ──────────────────────────────────────────────────────
-- Grit Taskboard's kanban layer. `id` is the real primary key here —
-- unlike `users` above (`cuid` primary key), this column mirrors the
-- platform `tasks` table's
-- own primary key name 1:1 (see packages/database/migrations/0001_core.sql +
-- 0002_platform_extensions.sql) since ops_tasks rows can be minted by EITHER
-- side: a card the user creates locally (client-minted text id, same
-- "cuid()-shaped, server just validates and inserts" convention every other
-- table here already follows — see this file's header), or a card born from
-- an inbound cross-app event (api/grit-events.js mints the id server-side).
-- `user_cuid` keeps this app's own row-scoping convention (every table
-- above has one) rather than an `organization_id` column — see
-- grit_org_links below for how an account maps to a Grit organization id;
-- ops_tasks itself is never queried by organization_id directly, only by
-- the resolved data-owner cuid, same as every other resource here.
create table if not exists ops_tasks (
  id                text primary key,
  user_cuid         text not null references users(cuid) on delete cascade,
  location_id       text,
  title             text not null,
  description       text,
  status            text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  -- 'system_inventory' | 'system_pos' -> minted by api/grit-events.js from an
  -- inbound inventory.threshold_breached/pos.velocity_surge webhook;
  -- 'manual' -> created by a person in the Ops board UI (api/ops-tasks.js).
  triggered_by      text not null default 'manual' check (triggered_by in ('system_inventory', 'system_pos', 'manual')),
  assigned_shift    text,
  -- Idempotency key for event-driven cards: the source event's event_id.
  -- NULL for manually created cards; unique when present (same
  -- "on conflict (source_event_id) do nothing" pattern the platform tasks
  -- table's own tasks_source_event_id_key index exists for).
  source_event_id   text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists idx_ops_tasks_user on ops_tasks(user_cuid);
create index if not exists idx_ops_tasks_user_status on ops_tasks(user_cuid, status);

-- One taskboard account <-> one Grit BizSuite organization id (an opaque
-- string minted by the platform side — grit-pos/grit-inventory/grit-passport
-- own what an "organization" actually is, this app only stores the link).
-- `user_cuid` is the primary key (not a separate cuid) since this is a
-- strict 1:1 mapping — api/grit-org-link.js's GET/PUT/DELETE always targets
-- "the calling account's org link", singular. `organization_id` is globally
-- unique too: one Grit organization is never linked to two different
-- taskboard accounts (api/grit-org-link.js's PUT returns 409 if it is).
-- This is also the table api/grit-events.js's webhook handler reads to map
-- an inbound envelope's `organization_id` back to the taskboard account
-- that should receive the resulting card — an unmapped organization_id is
-- a 202-and-skip there, never an error (see that file's header).
create table if not exists grit_org_links (
  user_cuid         text primary key references users(cuid) on delete cascade,
  organization_id   text not null unique,
  created_at        timestamptz not null default now()
);
