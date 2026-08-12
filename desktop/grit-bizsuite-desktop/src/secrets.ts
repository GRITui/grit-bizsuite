// Generates and persists the shared secrets every app needs to agree on
// (grit_passport SSO signing, the shared-events HMAC webhook secret, the
// service-to-service token) — real random values per install, never a
// hardcoded demo string shipped in the app. Written once on first launch,
// read on every subsequent launch.
import crypto from "node:crypto";
import fs from "node:fs";
import { secretsFile } from "./paths";

export interface GritSecrets {
  gritSessionSecret: string;
  gritEventWebhookSecret: string;
  gritServiceToken: string;
  /** Taskboard's own local bearer-token secret. Deliberately a separate
   * random value from every other secret here — the codebase's own
   * convention (apps/grit-taskboard's docs) is explicit that this must
   * never equal GRIT_SESSION_SECRET (or any other shared secret). */
  taskboardSessionSecret: string;
  /** Postgres role password for the embedded instance — not a "Grit" secret
   * per se, generated alongside the others since it has the same
   * "random per install, persisted, never hardcoded" requirement. */
  postgresPassword: string;
}

function randomSecret(): string {
  return crypto.randomBytes(32).toString("base64");
}

export function loadOrCreateSecrets(): GritSecrets {
  if (fs.existsSync(secretsFile)) {
    return JSON.parse(fs.readFileSync(secretsFile, "utf8")) as GritSecrets;
  }
  const secrets: GritSecrets = {
    gritSessionSecret: randomSecret(),
    gritEventWebhookSecret: randomSecret(),
    gritServiceToken: randomSecret(),
    taskboardSessionSecret: randomSecret(),
    postgresPassword: randomSecret(),
  };
  fs.mkdirSync(require("node:path").dirname(secretsFile), { recursive: true });
  // 0600 — this file holds real secrets, not world-readable.
  fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}
