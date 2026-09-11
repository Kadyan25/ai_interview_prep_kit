import type { PracticeStats } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

/**
 * Practice progress read against the job's own requirements rather than against
 * the deck. Knowing that thirty cards are done matters less than knowing which
 * must-have is still untouched two days before the interview.
 */
export function CoverageGrid({ stats }: { stats: PracticeStats }) {
  const rows = [...stats.byRequirement].sort((a, b) => {
    // Weakest must-haves first: that is the list worth acting on.
    if (a.priority !== b.priority) return a.priority === "must" ? -1 : 1;
    if (b.shaky !== a.shaky) return b.shaky - a.shaky;
    const aDone = a.cards === 0 ? 1 : a.seen / a.cards;
    const bDone = b.cards === 0 ? 1 : b.seen / b.cards;
    return aDone - bDone;
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No requirements to track"
        description="Nothing could be quoted from the posting, so there is nothing to measure practice against."
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="What you have practised"
        description="By requirement, weakest must-haves first."
      />
      <CardBody>
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const done = row.cards === 0 ? 0 : Math.round((row.seen / row.cards) * 100);
            return (
              <li key={row.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 text-zinc-800">{row.text}</span>
                  {row.priority === "must" ? <Badge tone="brand">Must</Badge> : null}
                  {row.shaky > 0 ? (
                    <Badge tone="red">
                      {row.shaky} shaky {row.shaky === 1 ? "card" : "cards"}
                    </Badge>
                  ) : null}
                  {row.cards === 0 ? <Badge tone="amber">No cards</Badge> : null}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100"
                    role="progressbar"
                    aria-valuenow={done}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Practised for ${row.text}`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.shaky > 0 ? "bg-amber-500" : done === 100 ? "bg-emerald-500" : "bg-brand-500",
                      )}
                      style={{ width: `${done}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted">
                    {row.seen} of {row.cards}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
