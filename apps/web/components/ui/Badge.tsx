import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "green" | "amber" | "red" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
