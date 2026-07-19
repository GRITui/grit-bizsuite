# Grit BizSuite — Backlog

Tracked gaps and proposed designs from the monorepo pivot + WMS/promotions
epic. Nothing here is scheduled; this is a reference list for the next pass.
Update in place — add items as they're found, move items to a "Shipped"
note (or just delete) once built, and update the source commit/PR when a
partial fix lands.

## P0 — real gaps worth closing next

### Discount resolution policy (configurable per tenant)

**Problem:** `evaluatePromotions` (`apps/grit-pos/lib/promotions.ts`) applies
every matching rule with no conflict resolution — a cart can be discounted
twice by two rules that both scope the same SKU (e.g. a "3-for-2" and a
"bulk 10% off" both hitting the same gloves).

**Proposed design** (two independent layers — they solve different
problems, not alternatives to pick between):

1. **Per-line resolution policy — tenant-configurable, not hardcoded.**
   New tenant setting, e.g. `discountStackingPolicy` on `Tenant`:
   - `NO_STACKING` (recommended default) — for any line, compute every
     applicable rule and apply only the single best one by discount amount.
     Safe out of the box, no merchant configuration required.
   - `STACK_ALL` — today's behavior, every matching rule applies. A merchant
     who genuinely wants generous overlapping discounts (or who has
     verified their rules never actually overlap) can opt into this
     explicitly rather than have it be the silent default.
   - Configured in `apps/grit-inventory`'s promotion admin (`/admin/promotions`,
     alongside a "Discount rules" settings panel), since that's where a
     merchant already thinks about how promotions behave.

2. **Per-order exclusion rules — always available, independent of the
   policy above.** A promotion can name specific *other* promotions it must
   never co-apply with on the same order, checked at cart-evaluation time
   regardless of whether the two rules even touch the same SKUs (e.g. "New
   Customer 15% off" should never combine with storewide "Clearance," even
   on unrelated products — a margin/business-policy conflict, not a
   unit-level double-dip). This matters under *either* stacking policy
   above, since `NO_STACKING` only resolves conflicts within one line, not
   across an entire order.

**Schema (grit-inventory, additive):**
- `Tenant.discountStackingPolicy` — string enum-as-varchar (`NO_STACKING` |
  `STACK_ALL`), default `NO_STACKING`, matching the existing
  varchar+CHECK-as-string convention used for `Tenant.tier`.
- `PromotionExclusion` join table: `(promotionId, excludedPromotionId)`,
  undirected pair (dedupe/normalize ordering at write time so A-excludes-B
  and B-excludes-A collapse to one row). Managed from the promotion
  create/edit form: "This promotion cannot combine with: [multi-select of
  the tenant's other active promotions]."

**Sync to POS:** both the policy setting and the exclusion graph need to
reach POS's local cache the same way promotion rules already do (POS is
offline-first, never calls Inventory live at checkout). Reuse the
established event-bus pattern rather than inventing a new mechanism:
- Simplest: extend the `promotion.updated` envelope's data with an
  `excluded_promotion_ids: string[]` field per rule (small, no new event
  type) and add a *separate* small event for the tenant-wide policy —
  `discount_policy.updated { policy: "NO_STACKING" | "STACK_ALL" }` — since
  policy isn't per-promotion, it doesn't fit `promotion.updated`'s shape.
  (If more tenant-wide settings show up later, consider generalizing this
  into a `tenant_settings.updated` event instead of one-off event types per
  setting.)
- `apps/grit-pos`: `PromotionRule` cache gains `excludedRuleIds Json` (array
  of ids, mirroring how `items` is already stored); a new small
  `TenantSetting`-ish cache row (or a single `discountStackingPolicy` column
  bolted onto whatever the POS-side tenant/session table is) holds the
  synced policy.
- `evaluatePromotions` changes shape: still computes every applicable rule
  first, then a resolution step applies the policy (best-per-line filter
  under `NO_STACKING`) and finally strips out any rule pair that violates an
  exclusion, before summing the discount.

**Open questions for whoever picks this up:**
- Does `NO_STACKING`'s "best rule" tiebreak need to be deterministic beyond
  "highest discount amount" (e.g. a stable secondary sort by rule creation
  order, so two equally-good rules don't flip-flop between requests)?
- Should exclusion be transitive/grouped (an "exclusivity group" of 3+
  mutually-exclusive promotions) or is pairwise sufficient for the
  business sizes this platform targets? Pairwise is simpler to build and to
  explain in the UI; groups scale better once a tenant has more than a
  handful of promotions.

### VAT-inclusive pricing (Thailand 7%, per-item exempt flag)

**Problem:** POS has no tax model at all today — `tax_amount` is hardcoded
to `0` on every `transaction.completed` event, and `Variant.price` is just
a flat sticker price with no VAT concept behind it.

**Requirement (as specified):** selling price defaults to **VAT-inclusive**
at Thailand's standard rate (7%) — the price staff enter and customers see
*is* the tax-inclusive price, and the excl-VAT/VAT split is derived from it
for receipts and reporting, not entered separately. Some items are
VAT-exempt by law, so this needs to be a **per-item flag**, not a
tenant-wide switch.

**Example (from the request):** sticker price 214 THB → price excl. VAT =
200 THB, VAT = 14 THB. I.e. `priceExclVat = price / 1.07`,
`vat = price - priceExclVat` (equivalently `price × 7/107`).

**Proposed design:**
- `Variant.vatApplicable: Boolean @default(true)` (`apps/grit-pos`'s
  Variant model) — per-SKU opt-out for legally VAT-exempt items. Default
  `true` since most retail goods are standard-rated; staff flip it off per
  item where the law requires it.
- `price` stays the single source of truth (VAT-inclusive when
  `vatApplicable`) — no new stored "excl-VAT price" column. Excl-VAT and
  VAT amounts are computed at render/receipt/reporting time from `price`
  and the flag, same pattern as `subtotal`/`discountTotal` are already
  derived-not-stored on `OrderDTO` (see `apps/grit-pos/app/api/orders/_lib/queries.ts`).
- **Don't hardcode 7%.** Thailand's VAT rate is set by periodically-renewed
  cabinet resolution (has been temporarily raised before) — make it a
  tenant-level setting (e.g. `Tenant.vatRate: Decimal @default(7.00)`) so a
  rate change is a config update, not a code change, and so the platform
  isn't Thailand-only if it's ever needed elsewhere.
- Order/receipt total needs a proper VAT breakdown, not just a single
  number: subtotal excl. VAT, VAT amount, VAT-exempt subtotal (for mixed
  carts), total incl. VAT — a real Thai tax invoice (ใบกำกับภาษี) itemizes
  VAT-applicable and VAT-exempt subtotals separately, it doesn't just show
  one blended tax line.
- Populating `tax_amount` on `transaction.completed` with the real computed
  VAT total closes the existing "no tax model" gap noted elsewhere in this
  doc, and would also feed `DailyReconciliation` (currently cash/card/qr/
  stripe totals only, no VAT liability column) for daily tax filing.

**Open questions for whoever picks this up:**
- Does `grit-inventory`'s own B2B `Order`/`OrderLine` pricing need the same
  treatment for wholesale invoices, or is this POS-only for now (retail
  checkout is the only place a "sticker price" concept really applies)?
- Exempt vs. zero-rated: Thai VAT law actually distinguishes VAT-exempt
  goods from zero-rated (0%) goods (e.g. exports) — both mean "no VAT
  charged" at checkout but are reported differently for filing. A single
  `vatApplicable: Boolean` collapses that distinction; fine for MVP, but
  flag it if proper VAT filing support is ever in scope.

### Other P0s

- **No automated tests for the WMS/promotions modules.** Groups, locations,
  picking, packing, labels, promotions — all verified live by hand, zero
  automated coverage. `apps/grit-inventory` has no test framework at all
  (ad-hoc scripts only); this epic didn't add any.
- **Dashboard stat cards beyond "Low stock" not audited** for the same
  aggregate-vs-per-store masking bug that was found and fixed on the
  low-stock widget — "Open orders," "Deliveries in flight" etc. on
  `/admin/dashboard` were never specifically checked across multi-location
  tenants.
- ~~**CI/sandbox gap:** `test-stripe-webhook.mjs` couldn't run.~~ **Fixed.**
  Root cause was the test itself, not the environment: it hardcoded a deep
  relative import `../node_modules/stripe/esm/stripe.esm.node.js`, which
  only ever resolves if `stripe` is installed directly inside
  `apps/grit-taskboard/node_modules` — under npm workspace hoisting it
  lives in the root `node_modules` instead, so the path 404'd. Switched to
  the bare specifier `import Stripe from 'stripe'` (Node's resolver walks
  up to the hoisted install; the package's `exports` map only exposes the
  top-level entry point anyway, not that deep subpath). `4 passed, 0
  failed` locally now.

## P1 — documented design decisions worth revisiting

- **Full SSO is still a bridge, not real.** Every app derives a
  `GritSession` from its own existing login rather than sharing one
  session; a user logs into POS and Inventory separately even though
  `@grit/passport`'s session shape is already unified across apps.
- **POS's synthetic SKU fallback** (`PRD-<internal-id>` when a line has no
  variant SKU) can't be matched by Inventory — cross-app stock decrement
  silently skips those items. Needs shared/real SKUs on both catalogs.
- **No Location model in POS** — the tenant/org id stands in for "the
  default store" on events (see the VAT-inclusive pricing P0 above for the
  related "no tax model" gap, now fleshed out separately).
- **Parcel labels are decorative, not scannable.** Self-drawn bar pattern,
  no real barcode symbology (Code128/QR), no carrier integration —
  intentionally an "internal MVP label" per its own doc comment.
- **Pick/pack/label mutations have no ADMIN gate**, unlike
  groups/locations/promotions (matches the existing `/transition` and
  `/payments` routes' "any staff on the floor" model) — worth an explicit
  product sign-off rather than an implicit default.
- **Reports' daily margin/COGS breakdown is null** — Inventory's COGS
  endpoint only returns a period total, so the dashboard can't chart it per
  day.
- **Taskboard's persona onboarding has no "trading company" option** — the
  live demo routed around it by picking "Other"; real trading-company
  signups hit the same gap.

## P2 — smaller / longer-tail

- `VariantLocation.isPrimary` is app-enforced only, no DB constraint — could
  end up with two "primary" rows for the same SKU+store under a future bug.
- Grit-inventory's original `Bundle`/`BundleComponent` model (build-to-sell
  composite SKUs, from the M1 handoff) remains stubbed and unused — a
  different concept from the new `bundle_deal` promotion type.
- No public storefront/checkout for Inventory, no real courier integration
  for Deliveries, no ML forecasting (still naive moving-average) — all
  called out as explicitly out of scope since the original M1 handoff doc.
- Turbopack can't resolve the shared packages' `.js→.ts` specifiers, so both
  Next apps build pinned to webpack — fixable with an extensionless-import
  cleanup in `packages/`, not urgent.
