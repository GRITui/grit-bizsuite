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
  <researcher_notes></researcher_notes>
</task_item>
