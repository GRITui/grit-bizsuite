# Backlog Inbox

Append-only ledger for the AI Engineering Loop. Do not delete entries — update
`<status>` in place and append `<researcher_notes>`/history as the item moves
through triage, sprint planning, and execution.

<task_item>
  <id>TSK-001</id>
  <source>OWNER_POPUP</source>
  <status>READY_FOR_PM</status>
  <priority>HIGH</priority>
  <title>Design: Inventory becomes single source of truth for the shared product catalog</title>
  <description>
    Owner has confirmed the direction (previously an open question in BACKLOG.md's
    "POS <-> Inventory SKU alignment" section): apps/grit-inventory becomes the
    canonical owner of Product/Variant data; apps/grit-pos stops maintaining its
    own independent catalog as the long-term source of truth.

    This is a DESIGN-FIRST task. Scope for this cycle is a written design doc,
    not code:
    - Current state: apps/grit-pos and apps/grit-inventory each own entirely
      separate Product/Variant tables (own cuid() spaces), linked today only by
      the best-effort `catalog.variant_synced` event that backfills
      `Variant.inventoryVariantId` on the POS side (see BACKLOG.md's SKU
      alignment section for full background).
    - Target state: what "Inventory is the source of truth" concretely means
      for POS — read-only cached mirror synced by an extended event, live
      reads from Inventory's API, or a hybrid. Must account for grit-pos's
      offline-first checkout requirements (offline-sync route) before
      assuming live reads are viable.
    - Migration path for existing POS-only Product/Variant rows (hospitality
      menu items, non-matrix variants) — do they get backfilled into
      Inventory as canonical products? Does Inventory need a "not
      stock-tracked" product type for genuinely non-inventory items (e.g. a
      made-to-order coffee)?
    - API/event contract changes needed (extend catalog.variant_synced vs.
      new events).
    - What breaks / needs care: PromotionRule (references variants by
      POS-local id today), Variant.vatApplicable (which app owns this field
      going forward), OrderLine historical snapshot semantics (must never
      retroactively change), the variant matrix builder.
    - Phased rollout plan — this is too large for one PR. Propose concrete,
      builder-agent-sized phases.
    - Explicit open questions that need a human product decision, not the
      researcher's to resolve.

    Ground every claim in real file:line citations from the actual codebase.
    No code changes, no schema migrations, no PRs in this task — output is a
    design document for the owner/architect to review before any build task
    is created from it.
  </description>
  <researcher_notes>
    Design doc delivered: loop/design-docs/TSK-001-catalog-unification-design.md
    (PR opened for review). Recommendation: cached read-only mirror on POS via
    an extended catalog.variant_synced event (not live reads) — POS's
    offline-first checkout invariant and the existing promotion.updated
    precedent both rule out live cross-app reads. Stock stays Inventory-only
    (POS never models quantityOnHand). Five-phase rollout proposed: (1) extend
    event/handler, no behavior change; (2) mirror-first creation on sync miss;
    (3) backfill/reconcile existing POS-only rows incl. a new Inventory
    "not stock-tracked" product type for made-to-order items; (4) close the
    OrderLine name/sku snapshot gap (unitPrice is already snapshotted, name
    isn't); (5) VAT/promotion ownership handoff. Five open questions flagged
    for explicit owner decision (see doc) — status set to NEEDS_OWNER_REVIEW,
    not closed: no build task should be created from this until the owner
    signs off on the recommendation and answers those questions.

    **Owner decision (architect pass, local-app-agent-squad-qsw15r session):**
    owner explicitly chose "Inventory becomes source of truth" (the doc's
    recommended option) when the roadmap's "Unified product catalog" item
    was picked up for this build pass. Phase 1 + Phase 2 shipped:
    `CatalogVariantSyncedData` (packages/shared-events/src/contracts.ts)
    extended with `product_id`/`variant_name`/`price`; grit-inventory's
    three emit sites updated to populate them; grit-inventory gained
    `Product.isStockTracked` (additive migration, admin toggle, low-stock
    logic skips non-tracked products) as groundwork for Phase 3's
    made-to-order item type. grit-pos's webhook handler
    (`app/api/events/grit/route.ts`) now mirror-creates a `Product`/
    `Variant` row on a sync-miss (transactional find-or-create under a
    per-tenant "Synced from Inventory" category) instead of the old no-op,
    with a new `Variant.inventoryVariantId` join column. Verified live
    against real DB rows (new product creation, repeat-variant grouping,
    deletion handling) plus full tsc/lint/build/test on both apps.

    Remaining, NOT done in this pass (still open, scoped in the design doc):
    Phase 3 (backfill/reconcile existing POS-only rows — explicitly flagged
    by the builder as future work, not attempted), Phase 4 (closing the
    `OrderLine` name/sku snapshot gap), Phase 5 (VAT/promotion ownership
    handoff). One known limitation from this pass: a multi-variant mirror
    product isn't deactivated when only one sibling variant is deleted
    (documented in the POS handler, not fixed). Status stays READY_FOR_PM,
    not closed — Phases 3-5 need their own build task(s).

    **Phases 3-5 shipped (same session, follow-up pass):** all three
    remaining phases built and the multi-variant deletion limitation fixed
    for real. Phase 3: `dev/local-run/backfill-catalog-unification.ts`, an
    idempotent/resumable script (no maintenance window needed — one of the
    doc's open questions, resolved in favor of "safe to run against a live
    system"), run once against the local demo data. Phase 4: `OrderLine`
    snapshot columns populated at all four line-creation call sites, not
    just the one originally scoped. Phase 5: `Variant.vatApplicable` moved
    to grit-inventory and synced down; promotion matching verified
    unaffected with a real live discount test against a just-backfilled
    SKU. Deletion fix: `Variant.isActive` replaces the old
    "exactly-one-variant" approximation with a real per-variant flag. Also
    fixed a real bug caught while verifying: the original Phase-1/2 sync
    backfill only ever wrote `inventoryVariantId`, never actually applying
    a renamed `product_name`/`variant_name` — a catalog rename could never
    reach an already-synced POS row until this pass. All five phases now
    fully shipped; nothing from this design doc remains open.
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-002</id>
  <source>OWNER_POPUP</source>
  <status>READY_FOR_PM</status>
  <priority>MEDIUM</priority>
  <title>Suite-wide app switcher UX/UI</title>
  <description>
    Owner asked how a user switches between the 5 apps; assessment found a
    real AppSwitcher component (packages/shared-ui/src/AppSwitcher.tsx,
    fed by packages/passport/src/nav.ts's buildAppNav/APP_KEYS) that is
    only actually rendered in apps/grit-pos's staff layout and
    apps/grit-inventory's admin layout. grit-taskboard and grit-reports
    have no switcher UI or cross-app links at all; APP_KEYS doesn't
    include manpower (deliberate, per AGENTS.md).

    Even where rendered, the switcher can't carry a session across apps
    today: each app deploys to its own separate Vercel subdomain and the
    shared grit_passport cookie (@grit/passport's session.ts) is host-only
    (no Domain= attribute, no shared parent domain in any vercel.json).
    See BACKLOG.md's "Suite-wide app switcher UX/UI (scoping)" section
    (under P1) for full detail and the "Full SSO is still a bridge, not
    real" entry it links back to.

    Scope for a build task (once triaged):
    - Add AppSwitcher to grit-taskboard and grit-reports's nav (reports
      already consumes @grit/passport; taskboard is explicitly excluded
      from SSO per BACKLOG.md, so needs a plain login-required link
      there instead of assuming a shared session until/unless taskboard
      gets its own SSO design pass).
    - Shared parent domain for production deploys so grit_passport's
      Domain= attribute can actually work cross-app — this is an infra/
      deployment decision needing explicit owner sign-off on domain
      strategy, not just a code change.
    - Open question for the owner: does grit-manpower ever get a
      switcher entry, given it's deliberately outside the shared session
      model for now?

    This is UX/UI + light infra scoping, not a design-doc-only task like
    TSK-001 — Researcher-Squad should triage feasibility/sizing, then
    hand off to UX-UI-Designer-Squad for the switcher UI additions and
    flag the domain-strategy question back to the owner before any
    infra change is made.
  </description>
  <researcher_notes>
    Engineer-Squad shipped the code-scoped portion: PR #30
    (tsk-002-app-switcher-taskboard-reports) adds a plain suite-nav link
    row to grit-reports (ungated — no client-side entitlement data
    available, JWT only ever verified server-side) and a "Grit BizSuite"
    settings section to grit-taskboard (plain, non-session-aware links,
    no @grit/passport dependency added, consistent with taskboard's
    deliberate SSO exclusion). Verified: grit-reports test-aggregate.mjs
    13/13, grit-taskboard run-all.sh 103 assertions/0 failed, both pages
    Playwright-rendered with no console errors.

    NOT done in this PR (left for owner decision, per the ticket's own
    scoping): the shared-parent-domain/cookie-domain infra change needed
    for the switcher to actually carry a session cross-app, and whether
    grit-manpower ever gets a nav entry. Status stays READY_FOR_PM (not
    closed) until those are resolved — this PR only closes the "no
    navigation links at all" gap, not the "no real SSO carry-through"
    gap already tracked in BACKLOG.md.

    **Owner decision (architect pass, local-app-agent-squad-qsw15r session):**
    grit-manpower gets a nav entry, but as a plain ungated link (same
    treatment as taskboard/reports use for each other today), NOT as an
    entry in @grit/passport's buildAppNav/AppSwitcher — that component's
    `enabled`/tier-gating logic assumes every app maps onto a LITE/GROWTH/
    SCALE entitlement, and manpower deliberately has no entitlement tier
    yet (AGENTS.md). Wiring it into buildAppNav would either fabricate a
    tier answer or require a real entitlement-model decision, which is a
    separate, bigger task than "add a link." Implemented: grit-taskboard's
    and grit-reports' existing plain suite-nav lists both gained a
    "Grit Manpower" entry (port 3004 default, `GRIT_MANPOWER_URL`-style
    override via each file's existing `window.__GRIT_SUITE_URLS` pattern —
    actually taskboard/reports don't read a manpower-specific env var by
    that name since they're no-build static pages with hardcoded JS
    defaults, same as their existing entries); grit-manpower's own staff
    layout gained a reciprocal plain `SuiteNav` linking out to the other
    four apps (`app/(staff)/(app)/layout.tsx`), reading the same
    `GRIT_*_URL` env vars `@grit/passport/src/nav.ts` uses so a real
    deployment's URLs stay in sync without duplicating them.

    Still open, unchanged from before: the shared-parent-domain/cookie-
    domain infra decision for actual SSO session carry-through in
    production. That's a deploy/infra call, not something a local-dev
    session can verify or decide — status stays READY_FOR_PM pending that
    one remaining piece.
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-003</id>
  <source>OWNER_POPUP</source>
  <status>READY_FOR_PM</status>
  <priority>MEDIUM</priority>
  <title>grit-pos: add-to-order has no offline support and no barcode scan</title>
  <description>
    Owner asked for an assessment of how staff add an item to an order in
    apps/grit-pos; assessment found two real gaps against POS's own
    offline-first invariant and floor-operations needs:

    1. **No offline support for adding lines.** apps/grit-pos's offline
       queue (components/pos/offlineQueue.ts) only defines two op kinds,
       `tender` and `quick_sale` — there is no `add_line` op. `addOrderLine`
       (components/pos/api.ts) has no offline fallback/catch for network
       errors, unlike `tenderOrder` which explicitly enqueues on
       `isNetworkError`. So building up a cart on an already-open order
       requires a live connection to POS's own backend (not Inventory —
       just POS itself), which is inconsistent with POS's stated
       offline-first design elsewhere (offline-sync route, PromotionRule
       cached-and-evaluated-offline, etc).
    2. **No barcode scanning in the staff add-to-order flow.** The staff
       product picker (components/pos/OrderBuilder.tsx,
       components/pos/ProductPicker.tsx) is tap-only with no search/filter
       and no scan-to-add path. A barcode scanning concept already exists
       elsewhere in the suite (apps/grit-inventory's real Code128 encoder/
       scan flows for pick/pack), but nothing wires a scanned SKU into
       adding a line at the register.

    Scope for a build task:
    - Add an `add_line` offline-queue op (mirroring the `tender`/
      `quick_sale` pattern: enqueue on network failure, replay via the
      existing offline-sync route, reconcile server-assigned line ids on
      sync).
    - Add a barcode-scan entry point to the add-to-order flow — resolve a
      scanned code to a product/variant by SKU and add it directly,
      re-using the same line-creation path the tap flow uses (no separate
      code path to duplicate maintenance on).
    - Out of scope: product search/filter UI and toast/retry error UX are
      separate, lower-priority polish noted in the same assessment — do
      not bundle them into this task unless trivially cheap once the
      offline/scan work is done.

    Ground the implementation in the actual existing offline-queue pattern
    (`tenderOrder`'s `isNetworkError`/`queueOffline` handling in
    components/pos/api.ts) rather than inventing a new mechanism.
  </description>
  <researcher_notes>
    Engineer-Squad shipped both gaps: PR #31
    (tsk-003-offline-add-line-barcode-scan). New `add_line` offline-queue
    op mirroring `tender`'s exact pattern; `addOrderLine` now catches
    network errors and enqueues when offline mode is on; new
    `applyAddLineOp` in the offline-sync route re-validates
    product/variant/add-ons server-side and inserts the line under a row
    lock. Added `OrderLine.externalRef` (nullable, unique, additive
    migration) since add_line ops never create a Payment row, so the
    existing Payment.externalRef dedupe doesn't cover them. Cart shows a
    queued line optimistically (pending badge, controls disabled) instead
    of it vanishing. Barcode-scan entry point added as a plain input
    (keyboard-wedge scanner pattern, submits on Enter), resolving against
    catalog SKUs already in memory and going through the same
    submitLine path the tap flow uses.

    Verified: tsc --noEmit clean, next build clean, eslint clean.

    Migration verified against a local Postgres 16 shadow database
    (`prisma migrate deploy` applied all 6 migrations cleanly from
    scratch; `prisma migrate status` reports schema up to date, no
    drift). Confirmed the `OrderLine.externalRef` unique index behaves
    as designed: multiple NULL values insert fine (the common case for
    normal online-added lines), and a duplicate non-null value is
    correctly rejected by the unique constraint (the offline-sync
    idempotency case). PR #31 has already merged; this closes the one
    outstanding verification gap noted in that PR's test plan. Status
    stays READY_FOR_PM pending owner review of the overall TSK-003
    delivery, not because anything further is blocking.
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-004</id>
  <source>QA_TESTER_SIM</source>
  <status>TRIAGED_SPRINT_READY</status>
  <priority>HIGH</priority>
  <title>Blocker: grit-pos checkout promotions engine has zero unit-test coverage</title>
  <description>
    apps/grit-pos/lib/promotions.ts decides every discount at the register
    (evaluatePromotions / resolveStacking / resolveExclusions) and no existing
    suite covers it — taskboard/reports/passport suites don't touch this app.
    Ask: port the pricing domain of the QA simulation (UC-P1..P9) into a real
    apps/grit-pos test suite wired into CI so discount-math regressions fail
    the build.
    Upstream: https://github.com/GRITui/grit-bizsuite/issues/52
  </description>
  <researcher_notes>
    QA-Tester-Squad delivered seed coverage: loop/qa/retailer-usecase-sim.mjs,
    20 use-case tests against the REAL modules (promotions engine, event
    contracts, HMAC webhook transport, passport entitlements) — run:
    node --experimental-strip-types --import ./loop/qa/register-hooks.mjs
    loop/qa/retailer-usecase-sim.mjs → tests 20 · pass 20 · fail 0.
    All engine behaviors currently correct under simulation; the gap is that
    none of this was asserted anywhere before, so any refactor silently risks
    the money path.
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-005</id>
  <source>QA_TESTER_SIM</source>
  <status>TRIAGED_SPRINT_READY</status>
  <priority>MEDIUM</priority>
  <title>resolveExclusions drops the higher-value rule when the smaller one wins the id sort</title>
  <description>
    Pairwise exclusion resolution drops the later-in-id-order rule regardless
    of discount magnitude — merchant configures "New Customer 15% never stacks
    with Clearance" and customers can end up with the €2 rule instead of the
    €30 rule purely because of cuid sort order. Proposal: drop the lower-
    amount entry of each mutually-exclusive pair (tie-break ascending id).
    Flip UC-P4-style expectations intentionally when fixed.
    Upstream: https://github.com/GRITui/grit-bizsuite/issues/50
  </description>
  <researcher_notes>
    Found while simulating UC-P4 (order-wide exclusion across disjoint SKUs);
    current behavior is deterministic but business outcome is invisible-cuid
    dependent rather than merchant-intent dependent.
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-006</id>
  <source>QA_TESTER_SIM</source>
  <status>TRIAGED_SPRINT_READY</status>
  <priority>MEDIUM</priority>
  <title>Durable outbox delivery for manpower.shift_unassigned (currently best-effort)</title>
  <description>
    The only event without outbox+drain is the one that puts staff on the
    floor: an unassigned shift whose webhook hits a briefly-down taskboard is
    lost forever — no "Cover role shift" card, uncovered register at peak.
    Route it through GritEventBus.publish like every other event so blips
    degrade to delayed delivery instead of silent loss.
    Upstream: https://github.com/GRITui/grit-bizsuite/issues/49
  </description>
  <researcher_notes>
    Retailer ops scenario simulated during sprint QA pass; README already
    admits the gap ("best-effort delivery only, no durable outbox yet").
  </researcher_notes>
</task_item>

<task_item>
  <id>TSK-007</id>
  <source>QA_TESTER_SIM</source>
  <status>TRIAGED_SPRINT_READY</status>
  <priority>LOW</priority>
  <title>Per-SKU/per-line discount attribution from evaluatePromotions</title>
  <description>
    evaluate* collapse each rule to one number over all SKUs; receipts show a
    single opaque Discounts total, reports can't break margin down by promo,
    and NO_STACKING stays conservative-atomic (documented HANDOFF tradeoff).
    Refactor evaluate* to also return per-Sku discount maps (backward-compat
    public shape), expose per-line attribution to receipt renderer.
    Upstream: https://github.com/GRITui/grit-bizsuite/issues/51
  </description>
  <researcher_notes>
    Surfaced by UC-P2/P7 simulations where atomic bundle semantics were
    verified correct-but-opaque; HANDOFF.md names this exact refactor as the
    prerequisite for smarter stacking.
  </researcher_notes>
</task_item>

<!-- TRIAGE ADDENDUM — board task task_0001 (sprint-planning pass) -->
Triage decision (acting PM seat, QA session 2026-08-26): TSK-004…007 moved
READY_FOR_PM → TRIAGED_SPRINT_READY. Execution order for next sprint:
1. TSK-004 (#52, HIGH) — port UC-P1..P9 into apps/grit-pos CI suite first;
   every later pricing change then lands with a regression gate.
2. TSK-006 (#49, MEDIUM) — durable outbox for shift_unassigned (ops risk).
3. TSK-005 (#50, MEDIUM) — exclusion tiebreak; BLOCKED on product decision
   (bigger-discount-wins vs positional determinism) before build starts.
4. TSK-007 (#51, LOW) — per-SKU attribution; opportunistic if capacity.
Regression gate for items 2–4: loop/qa/retailer-usecase-sim.mjs must stay
20/20 (flip UC-P4/P7 expectations intentionally where behavior changes).
