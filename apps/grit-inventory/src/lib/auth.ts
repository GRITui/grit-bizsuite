import bcrypt from "bcryptjs";
import {
  createSessionToken,
  verifySessionToken,
  type GritRole,
  type GritSession,
  type GritTier,
} from "@grit/passport";
import { db } from "@/lib/db";

export type Role = "OWNER" | "ADMIN" | "STAFF";

export type SessionPayload = {
  sub: string; // user id
  tenantId: string;
  storeId: string | null;
  role: Role;
  email: string;
  name: string;
};

/**
 * This app's local Role vocabulary maps onto @grit/passport's shared
 * GritRole ("owner" | "manager" | "staff") as: OWNER -> owner, ADMIN ->
 * manager, STAFF -> staff. Kept explicit (rather than assumed) because the
 * casing and naming differ from the local `Role` enum.
 */
export const ROLE_TO_GRIT: Record<Role, GritRole> = {
  OWNER: "owner",
  ADMIN: "manager",
  STAFF: "staff",
};

const GRIT_TO_ROLE: Record<GritRole, Role> = {
  owner: "OWNER",
  manager: "ADMIN",
  staff: "STAFF",
};

const VALID_TIERS: readonly GritTier[] = ["LITE", "GROWTH", "SCALE"];

function normalizeTier(tier: string | null | undefined): GritTier {
  return VALID_TIERS.includes(tier as GritTier) ? (tier as GritTier) : "GROWTH";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Signs this app's local SessionPayload into the shared `grit_passport` JWT
 * (via @grit/passport's createSessionToken) so any Grit app sharing the same
 * GRIT_SESSION_SECRET/SESSION_SECRET recognizes the session. Looks up the
 * tenant's commercial tier/addons the same way lib/passport.ts's
 * getGritContext does, so hasFeatureAccess never needs a DB round-trip at
 * request time.
 */
export async function signSession(payload: SessionPayload): Promise<string> {
  let tenant: { tier: string; addons: string[] } | null = null;
  try {
    tenant = await db.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { tier: true, addons: true },
    });
  } catch (err) {
    console.warn("[auth] tenant tier lookup failed, defaulting to GROWTH:", err);
  }

  const session: GritSession = {
    userId: payload.sub,
    organizationId: payload.tenantId,
    locationId: payload.storeId,
    role: ROLE_TO_GRIT[payload.role],
    email: payload.email,
    name: payload.name,
    tier: normalizeTier(tenant?.tier),
    addons: tenant?.addons ?? [],
  };

  return createSessionToken(session);
}

/** Verifies the shared `grit_passport` JWT and maps it back onto this app's local SessionPayload shape. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  const session = await verifySessionToken(token);
  if (!session) return null;
  return {
    sub: session.userId,
    tenantId: session.organizationId,
    storeId: session.locationId ?? null,
    role: GRIT_TO_ROLE[session.role],
    email: session.email,
    name: session.name ?? "",
  };
}

/** Role hierarchy: OWNER > ADMIN > STAFF. */
const ROLE_RANK: Record<Role, number> = { STAFF: 0, ADMIN: 1, OWNER: 2 };

export function hasRole(userRole: Role, minimumRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minimumRole];
}
