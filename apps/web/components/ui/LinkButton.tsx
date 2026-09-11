import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A link that looks like a button. Keeps navigation as a real anchor. */
export function LinkButton({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
        variant === "primary"
          ? "bg-brand-600 text-white hover:bg-brand-700"
          : "border border-line bg-white text-zinc-900 hover:bg-zinc-50",
        className,
      )}
    >
      {children}
    </Link>
  );
}
