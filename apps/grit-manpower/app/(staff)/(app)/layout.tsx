import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError, requireTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/components/SignOutButton";

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
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
