"use client";

import type { Confidence, PracticeCard } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: "Shaky",
  2: "Getting there",
  3: "Solid",
};

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  1: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
  2: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  3: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
};

/**
 * One card at a time. The answer stays hidden until asked for, because a card
 * you can see the back of teaches nothing.
 */
export function PracticeCardView({
  card,
  revealed,
  onReveal,
  onRate,
}: {
  card: PracticeCard;
  revealed: boolean;
  onReveal: () => void;
  onRate: (confidence: Confidence) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex-1 text-base font-medium leading-relaxed text-zinc-900">
            {card.front}
          </p>
          {card.confidence !== null ? (
            <Badge tone={card.confidence === 1 ? "red" : card.confidence === 2 ? "amber" : "green"}>
              Last time: {CONFIDENCE_LABELS[card.confidence]}
            </Badge>
          ) : (
            <Badge tone="brand">New</Badge>
          )}
        </div>

        {card.requirements.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {card.requirements.map((requirement) => (
              <Badge key={requirement.id} tone="neutral">
                {requirement.text}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-5 border-t border-line pt-5">
          {revealed ? (
            <p className="text-sm leading-relaxed text-zinc-700">{card.back}</p>
          ) : (
            <button
              type="button"
              onClick={onReveal}
              className="w-full rounded-lg border border-dashed border-line py-6 text-sm text-muted hover:bg-zinc-50"
            >
              Show the answer
              <span className="ml-2 rounded border border-line bg-white px-1.5 py-0.5 font-mono text-xs">
                Space
              </span>
            </button>
          )}
        </div>
      </div>

      {revealed ? (
        <div>
          <p className="mb-2 text-sm text-muted">How did that go?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {([1, 2, 3] as Confidence[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onRate(value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                  CONFIDENCE_STYLES[value],
                )}
              >
                {CONFIDENCE_LABELS[value]}
                <span className="rounded border border-current/20 bg-white/70 px-1.5 py-0.5 font-mono text-xs">
                  {value}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
