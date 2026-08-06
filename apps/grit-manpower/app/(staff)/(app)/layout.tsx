import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError, requireTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/components/SignOutButton";

// Plain, ungated links out to the rest of the Grit BizSuite — mirrors the
// treatment grit-taskboard/grit-reports already use (see their suite-nav
// blocks) rather than @grit/passport's buildAppNav/AppSwitcher: manpower has
// no shared session or tier entitlements to gate on (AGENTS.md — deliberately
// standalone), so every entry just links out plainly, same as those two.
// Defaults mirror packages/passport/src/nav.ts's DEFAULT_APP_URLS; override
// per-deployment via GRIT_POS_URL / GRIT_INVENTORY_URL / GRIT_TASKBOARD_URL /
// GRIT_REPORTS_URL env vars (same var names @grit/passport reads).
const SUITE_APPS = [
  { envVar: "GRIT_POS_URL", fallback: "http://localhost:3000", label: "Grit POS" },
  { envVar: "GRIT_INVENTORY_URL", fallback: "http://localhost:3001", label: "Grit Inventory" },
  { envVar: "GRIT_TASKBOARD_URL", fallback: "http://localhost:3002", label: "Grit Taskboard" },
  { envVar: "GRIT_REPORTS_URL", fallback: "http://localhost:3003", label: "Grit Reports" },
] as const;

function SuiteNav() {
  return (
    <nav aria-label="Grit BizSuite apps" className="hidden items-center gap-3 sm:flex">
      {SUITE_APPS.map(({ envVar, fallback, label }) => (
        <a
          key={envVar}
          href={(process.env[envVar] || fallback).replace(/\/+$/, "")}
          target="_blank"
          rel="noopener"
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireTenant();
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{tenant?.name ?? "Grit Manpower"}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{session.email}</p>
          </div>
          <nav className="hidden items-center gap-4 sm:flex">
            <Link href="/employees" className="text-sm text-zinc-600 dark:text-zinc-300">
              Employees
            </Link>
            <Link href="/schedule" className="text-sm text-zinc-600 dark:text-zinc-300">
              Schedule
            </Link>
            <Link href="/clock" className="text-sm text-zinc-600 dark:text-zinc-300">
              Clock
            </Link>
            <Link href="/payroll" className="text-sm text-zinc-600 dark:text-zinc-300">
              Payroll
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <SuiteNav />
          <SignOutButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
