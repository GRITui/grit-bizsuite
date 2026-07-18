import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Tokenized anonymous access — the mechanism behind QR dine-in table links
// and (later) pickup-order links. Kept generic/minimal on purpose: this
// module only knows how to mint and resolve opaque tokens, not what they
// unlock.
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 24; // 24 random bytes -> 32 url-safe base64 chars

/** Generates a cryptographically random, URL-safe opaque token. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Looks up a Table by its tokenized link. Returns the Table (including its
 * tenantId, so callers can scope subsequent queries) or `null` if the token
 * doesn't match any table — callers should treat that as a generic 404, not
 * leak whether the token was merely malformed vs. genuinely unknown.
 */
export async function verifyTableToken(token: string) {
  if (!token) return null;

  const table = await prisma.table.findUnique({
    where: { token },
  });

  return table ?? null;
}
