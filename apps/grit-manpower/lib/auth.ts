import "server-only";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import {
  createSessionToken,
  verifySessionToken,
  GRIT_SESSION_COOKIE,
  SESSION_TTL_SECONDS as GRIT_SESSION_TTL_SECONDS,
  type GritRole,
  type GritSession,
  type GritTier,
} from "@grit/passport";
import type { UserRole } from "@/app/generated/prisma/enums";

// ---------------------------------------------------------------------------
// SSO migration (Wave 5 pattern, copied from apps/grit-inventory): this app
// used to be standalone — its own JWT session under its own cookie name,
// independent of the `grit_passport` SSO cookie the other Grit apps share.
// It now mints BOTH cookies on login: the legacy `grit_manpower_session`
// cookie (so existing manpower-only deploys/tests keep working) and the
// shared `grit_passport` cookie (so this app participates in real
// suite-wide SSO). Reads prefer the shared cookie when present, falling
// back to the legacy one.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "grit_manpower_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * This app's local `UserRole` ("owner" | "admin" | "staff") maps onto
 * @grit/passport's shared `GritRole` ("owner" | "manager" | "staff") as:
 * owner -> owner, admin -> manager, staff -> staff. Kept explicit because
 * the vocabulary differs ("admin" here, "manager" in the shared contract).
 */
export const ROLE_TO_GRIT: Record<UserRole, GritRole> = {
  owner: "owner",
  admin: "manager",
  staff: "staff",
};

const GRIT_TO_ROLE: Record<GritRole, UserRole> = {
  owner: "owner",
  manager: "admin",
  staff: "staff",
};

/**
 * Grit Manpower has no tenant-level commercial tier/addon concept of its own
 * (it isn't gated by the LITE/GROWTH/SCALE matrix the way pos/inventory
 * are) — it is deliberately stamped as the full "SCALE" tier, the minimum
 * tier that grants every app/feature in @grit/passport's TIER_MATRIX
 * (see packages/passport/src/entitlements.ts), so `hasFeatureAccess` checks
 * made by *other* apps against a manpower-originated session never
 * incorrectly deny access.
 */
const MANPOWER_GRIT_TIER: GritTier = "SCALE";

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

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Copy .env.example to .env and fill in a real secret.",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs this app's local user identity into the shared `grit_passport` JWT
 * (via @grit/passport's createSessionToken) so any Grit app sharing the
 * same GRIT_SESSION_SECRET/SESSION_SECRET recognizes the session. Manpower
 * has no per-user location/store scoping today, so `locationId` is always
 * org-wide (null), and no tenant tier/addon concept, so `tier` is the fixed
 * MANPOWER_GRIT_TIER (see its docstring above).
 */
export async function signGritSession(user: {
  id: string;
  tenantId: string;
  role: UserRole;
  email: string;
}): Promise<string> {
  const session: GritSession = {
    userId: user.id,
    organizationId: user.tenantId,
    locationId: null,
    role: ROLE_TO_GRIT[user.role],
    email: user.email,
    tier: MANPOWER_GRIT_TIER,
    addons: [],
  };
  return createSessionToken(session);
}

export async function createSession(user: {
  id: string;
  tenantId: string;
  role: UserRole;
  email: string;
}): Promise<void> {
  const token = await new SignJWT({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  // Also mint the shared `grit_passport` cookie so this login participates
  // in real suite-wide SSO (see module header comment). Best-effort: don't
  // let a misconfigured/missing shared secret break this app's own login —
  // the legacy cookie above still grants a working manpower session.
  try {
    const gritToken = await signGritSession(user);
    cookieStore.set(GRIT_SESSION_COOKIE, gritToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: GRIT_SESSION_TTL_SECONDS,
    });
  } catch (err) {
    console.warn("[auth] failed to mint shared grit_passport cookie:", err);
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(GRIT_SESSION_COOKIE);
}

/**
 * Reads and verifies the session for the current request. Prefers the
 * shared `grit_passport` cookie when present and valid (SSO — set by this
 * app's own login, or by any other Grit app sharing the same session
 * secret), falling back to the legacy `grit_manpower_session` cookie so
 * sessions minted before this migration keep working. Returns `null` for
 * anything invalid on both (missing cookie, no secret configured, bad
 * signature, expired, malformed payload) — never throws, so callers can
 * treat `null` uniformly as "not logged in".
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();

  const gritToken = cookieStore.get(GRIT_SESSION_COOKIE)?.value;
  if (gritToken) {
    const gritSession = await verifySessionToken(gritToken);
    if (gritSession) {
      return {
        userId: gritSession.userId,
        tenantId: gritSession.organizationId,
        role: GRIT_TO_ROLE[gritSession.role],
        email: gritSession.email,
      };
    }
  }

  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let secret: Uint8Array;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    if (
      typeof payload.userId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role as UserRole,
      email: payload.email,
    };
  } catch {
    return null;
  }
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
