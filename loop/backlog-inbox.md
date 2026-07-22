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
  <researcher_notes></researcher_notes>
</task_item>
