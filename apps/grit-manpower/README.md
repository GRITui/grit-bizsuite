# Grit Manpower

Next.js 16 + Prisma 7 + Neon workforce-management app for the Grit BizSuite:
employee records, shift scheduling, clock-in/out attendance, and payroll.

Runs standalone: its own deploy, its own `DATABASE_URL`, its own staff login.
Joined the suite's shared SSO and event bus: login mints both this app's own
`grit_manpower_session` cookie and the shared `grit_passport` cookie
(`@grit/passport`, `lib/auth.ts`), and it publishes `manpower.shift_unassigned`
(`lib/events.ts`) whenever a shift is created or updated with no employee
assigned. It has no entitlement tier of its own — sessions it originates are
stamped as the full `SCALE` tier so other apps' `hasFeatureAccess` checks
never wrongly deny it — and no durable event outbox yet (publishing is
best-effort webhook delivery only); see `AGENTS.md` at the repo root.

## Domains

- **Employees** (`Employee`, `EmployeeDocument`, `WageRate`) — the HR record:
  profile fields, free-form documents (contracts, IDs, certifications — file
  storage itself is out of scope, `fileUrl` is just a pasted link), and an
  effective-dated hourly wage history.
- **Scheduling** (`Location`, `Shift`) — shifts belong to a location, can be
  unassigned ("open"), and carry a `status` (`scheduled` / `published` /
  `completed` / `cancelled`).
- **Attendance** (`TimeEntry`) — clock-in/clock-out per employee, optionally
  tied to a shift. Doesn't require a pre-scheduled shift to clock in.
- **Payroll** (`PayrollPeriod`, `PayrollRecord`) — generating a period sums an
  employee's closed `TimeEntry` hours within the date range, applies the
  employee's wage rate in effect at the period start, and splits hours over
  40 in the period into overtime (see the code comment in
  `app/api/payroll/periods/[id]/generate/route.ts` — this is a documented MVP
  simplification, not a real labor-law overtime engine). Finalizing a period
  locks it against regeneration.

## Running locally

```bash
cp .env.example .env   # fill in DATABASE_URL + SESSION_SECRET
npm install --workspace=grit-manpower
npm run dev --workspace=grit-manpower
```

Required to run: `DATABASE_URL` (Neon Postgres, or a local Postgres —
`lib/prisma.ts` falls back to `@prisma/adapter-pg` for `localhost`/`127.0.0.1`
connection strings so you don't need real Neon credentials for local dev),
`SESSION_SECRET` (signs this app's own session JWT — generate with
`openssl rand -base64 32`).

## Migrations

Same pattern as `grit-pos`/`grit-inventory`: `vercel.json`'s `buildCommand`
runs `npx prisma migrate deploy` before every build, so pushing a new
migration auto-applies it on deploy.
