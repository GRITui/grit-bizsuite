import { redirect } from "next/navigation";
import Link from "next/link";
import { buildAppNav, hasFeatureAccess } from "@grit/passport";
import { AppSwitcher } from "@grit/shared-ui";
import { getGritContext } from "@/lib/passport";
import { LogoutButton } from "@/components/logout-button";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/deliveries", label: "Deliveries" },
  { href: "/admin/reports", label: "Reports" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getGritContext();
  if (!ctx) {
    redirect("/login");
  }
  const { local: session, grit } = ctx;

  const navItems = [...NAV_ITEMS];
  // Multi-location surfaces are hidden below SCALE (GROWTH is gated from
  // reading multiple location tables); the pages themselves also gate.
  if (hasFeatureAccess(grit, "inventory.multi_location")) {
    navItems.splice(2, 0, { href: "/admin/stores", label: "Stores" });
  }
  if (hasFeatureAccess(grit, "inventory.transfers")) {
    navItems.splice(3, 0, { href: "/admin/transfers", label: "Transfers" });
  }

  const appNav = buildAppNav(grit);

  return (
    <div className="flex min-h-screen flex-1 bg-zinc-50 dark:bg-zinc-950">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Grit Inventory</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{session.name}</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <LogoutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <AppSwitcher items={appNav} currentApp="inventory" />
        </header>
        <main className="flex-1 overflow-x-hidden p-6">{children}</main>
      </div>
    </div>
  );
}
