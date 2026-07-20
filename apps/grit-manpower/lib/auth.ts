import "server-only";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/app/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Standalone session-based staff authentication, tenant-scoped.
//
// This app is standalone for now (see AGENTS.md / README.md) — it mints its
// own JWT session under its own cookie name, independent of the
// `grit_passport` SSO cookie the other Grit apps share. Wiring this up to
// @grit/passport is a deliberate follow-up, not part of this MVP.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "grit_manpower_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Reads and verifies the session cookie for the current request. Returns
 * `null` for anything invalid (missing cookie, no secret configured, bad
 * signature, expired, malformed payload) — never throws, so callers can
 * treat `null` uniformly as "not logged in".
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
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
