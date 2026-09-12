"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, LogOut, NotebookPen, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

const links = [
  { href: "/kits", label: "My kits", icon: LayoutGrid },
  { href: "/kits/new", label: "New kit", icon: Plus },
];

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link href="/kits" className="flex items-center gap-2 font-semibold text-zinc-900">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-white">
              <NotebookPen className="size-4" aria-hidden />
            </span>
            <span className="text-sm">Prep Kit</span>
          </Link>

          <nav aria-label="Main" className="ml-2 hidden gap-1 sm:flex">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm",
                  pathname === href
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-zinc-600 hover:bg-zinc-100",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" aria-hidden />
              {/* sr-only rather than hidden: on a phone the label is still the
                  button's accessible name, it is just not painted. */}
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white sm:hidden"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs",
              pathname === href ? "text-brand-700" : "text-zinc-500",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
