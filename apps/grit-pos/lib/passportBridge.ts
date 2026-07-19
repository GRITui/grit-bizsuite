import "server-only";

import { cookies } from "next/headers";
import type { GritSession } from "@grit/passport";
import { GRIT_SESSION_COOKIE, hasFeatureAccess, verifySessionToken } from "@grit/passport";

// ---------------------------------------------------------------------------
// Grit Passport bridge.
//
// lib/auth.ts's getSession() now maps a real `grit_passport` cookie (a
// GritSession-shaped JWT, minted at login by createSession) back into this
// app's local SessionPayload shape for its many existing callers. This
// bridge instead reads the raw cookie and verifies it directly, since the
// full GritSession — including `tier`/`addons`, stamped into the token at
// login — is right there; no need to re-derive it (and no need for the old
// per-request Tenant lookup for tier/addons, which the token already carries).
// ---------------------------------------------------------------------------

/**
 * Reconstructs the suite-wide `GritSession` straight from the `grit_passport`
 * cookie. Returns null when not logged in / the cookie is missing or invalid.
 */
export async function getGritSession(): Promise<GritSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(GRIT_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Convenience gate: is this org entitled to a feature (tier + addons)? */
export function sessionHasFeature(session: GritSession | null, feature: string): boolean {
  return session !== null && hasFeatureAccess(session, feature);
}
