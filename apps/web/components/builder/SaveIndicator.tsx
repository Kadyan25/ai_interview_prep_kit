"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { SaveState } from "@/lib/useKitDraft";

export function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "idle") return null;

  return (
    <p
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={error ?? undefined}
    >
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : null}
      {state === "saved" ? (
        <>
          <Check className="size-3.5 text-emerald-600" aria-hidden />
          Saved
        </>
      ) : null}
      {state === "error" ? (
        <span className="inline-flex items-center gap-1.5 text-red-600">
          <AlertCircle className="size-3.5" aria-hidden />
          {error ?? "Not saved"}
        </span>
      ) : null}
    </p>
  );
}
