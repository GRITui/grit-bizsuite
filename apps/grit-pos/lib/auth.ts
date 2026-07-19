import "server-only";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import {
  createSessionToken,
  verifySessionToken,
  GRIT_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type GritSession,
  type GritTier,
} from "@grit/passport";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/app/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Session-based staff authentication, tenant-scoped.
//
// This app mints/verifies the shared Grit Passport session (`grit_passport`
// cookie, @grit/passport's createSessionToken/verifySessionToken) so a
// session created here is recognized by any other Grit app sharing the same
// GRIT_SESSION_SECRET/SESSION_SECRET. The local `SessionPayload` shape below
// (userId/tenantId/role/email) is kept identical to before so the many
// existing call sites across this app don't need to change — it's just
// mapped from the underlying `GritSession` on read.
// ---------------------------------------------------------------------------

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message = "Unauthorized", status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// -- Password hashing --------------------------------------------------------

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

// -- Session issuing / reading -----------------------------------------------

type SessionUser = {
  id: string;
  tenantId: string;
  role: UserRole;
  email: string;
  /**
   * Tenant's commercial tier/addons, if the caller already has them in scope
   * (e.g. from a transaction that just created/loaded the Tenant) — avoids a
   * redundant lookup. Falls back to a `Tenant` read keyed by `tenantId` when
   * omitted.
   */
  tenant?: { tier: string | null; addons: string[] | null };
};

const TIERS: readonly GritTier[] = ["LITE", "GROWTH", "SCALE"];

function normalizeTier(tier: string | null | undefined): GritTier {
  return TIERS.includes(tier as GritTier) ? (tier as GritTier) : "LITE";
}

/**
 * Signs a shared Grit Passport session (`GritSession`) for the given user and
 * sets it as the `grit_passport` httpOnly cookie on the current response.
 * Must be called from a Route Handler or Server Function (anywhere
 * `cookies().set` is allowed).
 */
export async function createSession(user: SessionUser): Promise<void> {
  let tier: GritTier;
  let addons: string[];
  if (user.tenant) {
    tier = normalizeTier(user.tenant.tier);
    addons = user.tenant.addons ?? [];
  } else {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { tier: true, addons: true },
    });
    tier = normalizeTier(tenant?.tier);
    addons = tenant?.addons ?? [];
  }

  const gritSession: GritSession = {
    userId: user.id,
    organizationId: user.tenantId,
    locationId: null,
    // UserRole in this schema is already the unified owner/manager/staff set.
    role: user.role,
    email: user.email,
    tier,
    addons,
  };

  const token = await createSessionToken(gritSession);

  const cookieStore = await cookies();
  cookieStore.set(GRIT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clears the shared Grit Passport session cookie (logout). */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(GRIT_SESSION_COOKIE);
}

/**
 * Reads and verifies the shared `grit_passport` session cookie for the
 * current request, mapping the `GritSession` back into this app's existing
 * local `SessionPayload` shape. Returns `null` if there is no cookie, or
 * it's missing/expired/invalid — never throws, so callers can decide how to
 * react.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(GRIT_SESSION_COOKIE)?.value;
  const gritSession = await verifySessionToken(token);
  if (!gritSession) return null;

  return {
    userId: gritSession.userId,
    tenantId: gritSession.organizationId,
    role: gritSession.role as UserRole,
    email: gritSession.email,
  };
}

/**
 * Loads the full, fresh User row for the current session (in case the
 * cached role/email in the JWT has since changed). Returns `null` if there
 * is no valid session or the user no longer exists.
 */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });
  if (!user || user.tenantId !== session.tenantId) return null;

  return user;
}

/**
 * Guard for use at the top of a Route Handler or Server Component: returns
 * the verified session, or throws `AuthError` (401) if the caller isn't
 * authenticated. Route handlers should catch `AuthError` and translate it
 * into a JSON 401 response.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new AuthError("Not authenticated");
  }
  return session;
}
