import "server-only";

import { AuthError, requireAuth, type SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Tenant-scoping helper. Every staff-side Prisma query must filter by
// `tenantId` — centralizing how that id is obtained (from the authenticated
// session, never from client-supplied input) makes it hard to accidentally
// leak data across tenants.
// ---------------------------------------------------------------------------

export async function requireTenant(): Promise<SessionPayload> {
  return requireAuth();
}

/** Convenience shortcut when only the tenantId is needed. */
export async function requireTenantId(): Promise<string> {
  const session = await requireTenant();
  return session.tenantId;
}

export { AuthError };
