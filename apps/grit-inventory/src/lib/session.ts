import "server-only";
import { cookies } from "next/headers";
import { GRIT_SESSION_COOKIE, SESSION_TTL_SECONDS } from "@grit/passport";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth";

export async function createSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(GRIT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySessionCookie() {
  const store = await cookies();
  store.delete(GRIT_SESSION_COOKIE);
}

/** Reads and verifies the shared session cookie from the request cookie jar. Null if absent/invalid/expired. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(GRIT_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}
