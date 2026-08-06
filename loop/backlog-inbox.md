# Backlog Inbox

Append-only ledger for the AI Engineering Loop. Do not delete entries — update
`<status>` in place and append `<researcher_notes>`/history as the item moves
through triage, sprint planning, and execution.

<task_item>
  <id>TSK-001</id>
  <source>OWNER_POPUP</source>
  <status>NEEDS_OWNER_REVIEW</status>
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
