# TenderPanel manual test script

Covers GitHub issues **#41** (quick-cash tender controls) and **#42** (inline
failure feedback + retry) in `components/pos/TenderPanel.tsx`.

Run against a dev server (`npm run dev` in `apps/grit-pos`) logged in as staff,
with an open order that has at least one line.

## Quick-cash chips (#41)

1. Open an in-progress order → **Tender payment**. The amount field is
   prefilled with the exact balance.
2. Chip row shows **Exact $X.XX** first, then next-largest notes strictly
   above the balance (default `$5/$10/$20/$50/$100`), then **Clear**.
   - Balance `12.50` ⇒ chips: Exact, `$20.00`, `$50.00`, `$100.00`
     (no `$5`/`$10` — those would under-tender; no `$20` duplicate when
     balance is exactly `20`).
3. Tap each note chip: the amount field updates to that value.
4. Type a custom amount (e.g. `7.25`) after tapping a chip: typing still wins;
   no chip re-fires.
5. Tap **Clear**: field empties and **Record payment** becomes disabled
   (existing `isValidAmount` gate intact).
6. Tap **Exact**, submit: payment records, change due banner appears for
   over-tenders, order flips to closed/partially paid exactly as before.

## Inline failure feedback + retry (#42)

Simulate a failure by stopping the database or blocking
`POST /api/orders/[orderId]/tender` in devtools.

1. Submit a tender while failing. Inside the modal, a red alert region appears
   with the error message and a **Retry payment** button. The cart column may
   show the same message — both come from the parent's shared error state.
2. Screen reader check: region is `aria-live="polite"` and mounted before any
   error exists, so the failure is announced without focus moves.
3. While the request is in flight: **Record payment**, **Retry payment**, and
   all chips are disabled (no double-submit). Verify via network tab there is
   only ever one in-flight tender request per click.
4. Restore the backend and tap **Retry payment**: same amount/tender type is
   submitted once; on success the modal closes (fully paid) or updates the
   balance (split tender).
5. After a failure, adjust the amount or tender type, then retry: the retry
   submits the *current* form values, not the failed ones.
6. Close the modal after a failure, fix the cause, reopen from
   **Tender payment**: no stale error is shown inside the fresh modal (the
   parent clears errors on open).

## Regression sweep

- Split tender: partial cash payment keeps order open; panel reopens with new
  balance and correct chips for it.
- Offline mode (`pos.offline_mode` entitlement): with network down, tender is
  queued (blue notice) instead of erroring — the red alert path must NOT fire
  for offline capture, only for real HTTP/validation failures.
- Empty/cancelled orders never reach the modal (button disabled as before).
