// One-off smoke test (not part of the regular suite): simulates the
// transaction.completed webhook grit-pos would send, to verify the
// POS<->Inventory SKU/id matching described in BACKLOG.md actually works
// end to end against this app's real event consumer. Requires the local
// dev server running on PORT (default 3001) with GRIT_EVENT_WEBHOOK_SECRET
// set to match this script's SECRET.
//
// Usage: node scripts/smoke-test-sku-alignment.mjs
import crypto from "node:crypto";

const PORT = process.env.PORT || 3001;
const SECRET = process.env.GRIT_EVENT_WEBHOOK_SECRET || "dev-smoke-test-webhook-secret-abc123";
const TENANT_ID = "cmru2ya3w0000xg7d32h75qax";
const VARIANT_ID = "cmru2yahg0002xg7d0bkba7oq"; // TSHIRT-M-BLK

function hmacSha256Hex(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function signWebhook(secret, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const digest = hmacSha256Hex(secret, `${nowSeconds}.${rawBody}`);
  return {
    "content-type": "application/json",
    "x-grit-timestamp": String(nowSeconds),
    "x-grit-signature": `v1=${digest}`,
  };
}

async function send(label, item) {
  const body = {
    event: "transaction.completed",
    event_id: crypto.randomUUID(),
    organization_id: TENANT_ID,
    timestamp: new Date().toISOString(),
    data: {
      transaction_id: `smoke-${label}`,
      location_id: TENANT_ID, // POS's "no specific store" convention
      total_amount: item.price * item.quantity,
      tax_amount: 0,
      items: [item],
    },
  };
  const rawBody = JSON.stringify(body);
  const headers = signWebhook(SECRET, rawBody);
  const res = await fetch(`http://localhost:${PORT}/api/events/grit`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  const json = await res.json();
  console.log(`\n[${label}] HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

const results = {};

// Case 1: id-based match (the "real fix" — catalog.variant_synced path)
results.byId = await send("by-id", {
  sku: "WRONG-SKU-DOESNT-MATTER",
  inventory_variant_id: VARIANT_ID,
  quantity: 2,
  price: 15,
});

// Case 2: SKU-string fallback match (pre-sync sale)
results.bySku = await send("by-sku", {
  sku: "TSHIRT-M-BLK",
  quantity: 1,
  price: 15,
});

// Case 3: genuine mismatch (neither id nor SKU known) — should land in
// UnmatchedSaleItem, not silently vanish.
results.mismatch = await send("mismatch", {
  sku: "TOTALLY-UNKNOWN-SKU-999",
  quantity: 1,
  price: 15,
});

console.log("\n=== Summary ===");
console.log("by-id  processed:", results.byId.processed, "warnings:", results.byId.warnings);
console.log("by-sku processed:", results.bySku.processed, "warnings:", results.bySku.warnings);
console.log("mismatch processed:", results.mismatch.processed, "warnings:", results.mismatch.warnings);
