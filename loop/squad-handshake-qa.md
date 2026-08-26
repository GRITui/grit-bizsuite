<squad_metadata>
  <squad_name>QA-Tester-Squad</squad_name>
  <current_status>IDLE</current_status>
  <active_task_id></active_task_id>
  <sprint_completion_percentage>100</sprint_completion_percentage>
</squad_metadata>

## Current Focus
Sprint QA pass complete. Simulated retailer business use cases against the
real production modules (no mocks of units under test):

- Harness: `loop/qa/retailer-usecase-sim.mjs` (+ `register-hooks.mjs`,
  `lib/stub-server-only.mjs`) — pure node:test, 20 use cases:
  - Domain A · POS pricing (UC-P1…P9): stacking policy, exclusions, windows,
    bundles, money guards, split-line aggregation
  - Domain B · event chain (UC-E1…E6): contract validation, HMAC tamper /
    forgery / replay rejection
  - Domain C · tiers (UC-T1…T5): LITE/GROWTH/SCALE gating, role trimming,
    typed EntitlementError guard
- Baseline suites re-run green before simulating: taskboard 103/103,
  reports 13/13, passport 15/15.
- Run: `node --experimental-strip-types --import ./loop/qa/register-hooks.mjs
  loop/qa/retailer-usecase-sim.mjs`

## Recent Commits / PRs
- test(qa): retailer use-case simulation harness + QA findings wired into
  backlog-inbox (TSK-004…007) — this branch

## Blockers & QA Failures
No functional failures — all 20 simulations pass. Filed as backlog instead:
- BLOCKER (test debt) #52 — promotions engine had zero coverage → TSK-004
- #50 — exclusion tiebreak ignores discount magnitude → TSK-005
- #49 — shift_unassigned lacks durable outbox → TSK-006
- #51 — no per-SKU discount attribution → TSK-007

## Cross-Squad Requests
- Engineer-Squad: port UC-P1…P9 into an apps/grit-pos suite in CI (TSK-004).
- Researcher: confirm intended exclusion-tiebreak semantics before TSK-005
  build (product decision: bigger-discount-wins vs positional determinism).

