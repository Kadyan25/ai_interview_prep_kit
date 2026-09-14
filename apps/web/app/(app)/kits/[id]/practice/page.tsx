"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, PartyPopper, RotateCw } from "lucide-react";
import type { Confidence, PracticeCard } from "@prep/shared";
import { CoverageGrid } from "@/components/practice/CoverageGrid";
import { CONFIDENCE_LABELS, PracticeCardView } from "@/components/practice/PracticeCardView";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

export default function PracticePage() {
  const params = useParams<{ id: string }>();
  const kitId = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [rated, setRated] = useState<Record<string, Confidence>>({});

  const sessionQuery = useQuery({
    queryKey: ["practice", kitId],
    // The order is decided once at the start; re-sorting mid-session would move
    // the ground under the user's feet.
    queryFn: () => api.practiceSession(kitId).then((r) => r.cards),
    refetchOnMount: "always",
    staleTime: Infinity,
  });

  const statsQuery = useQuery({
    queryKey: ["practice-stats", kitId],
    queryFn: () => api.practiceStats(kitId).then((r) => r.stats),
  });

  const answer = useMutation({
    mutationFn: ({ cardId, confidence }: { cardId: string; confidence: Confidence }) =>
      api.practiceAnswer(kitId, cardId, confidence),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practice-stats", kitId] }),
    onError: () => toast("That answer was not saved. Check your connection.", "error"),
  });

  const cards = sessionQuery.data ?? [];
  const current: PracticeCard | undefined = cards[index];
  const finished = cards.length > 0 && index >= cards.length;

  const rate = useCallback(
    (confidence: Confidence) => {
      if (!current) return;
      setRated((r) => ({ ...r, [current.id]: confidence }));
      answer.mutate({ cardId: current.id, confidence });
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [answer, current],
  );

  // Space reveals, 1/2/3 rate. The whole loop is reachable without a mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Enter and Space on a focused link or button belong to that control.
      if (target?.closest("a, button, [role=button], summary")) return;
      if (!current) return;

      // Both forms: some input methods report the spacebar only as key " ".
      if (event.code === "Space" || event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        rate(Number(event.key) as Confidence);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, revealed, rate]);

  const restart = () => {
    setIndex(0);
    setRevealed(false);
    setRated({});
    void sessionQuery.refetch();
  };

  if (sessionQuery.isPending) return <SkeletonList rows={3} />;

  if (sessionQuery.isError) {
    return (
      <EmptyState
        title="Could not start a practice session"
        description="The kit may still be generating, or the API may be waking up."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => sessionQuery.refetch()}>
              Try again
            </Button>
            <LinkButton href={`/kits/${kitId}`} variant="secondary">
              Back to the kit
            </LinkButton>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Practice</h1>
          <p className="text-sm text-muted">
            Cards you have not seen come first, then the ones you found hardest.
          </p>
        </div>
        <LinkButton href={`/kits/${kitId}`} variant="secondary">
          <ArrowLeft className="size-4" aria-hidden />
          Back to the kit
        </LinkButton>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="This kit has no flashcards"
          description="Add a few on the kit's flashcards tab, then come back."
          action={<LinkButton href={`/kits/${kitId}`}>Open the kit</LinkButton>}
        />
      ) : finished ? (
        <SessionSummary
          rated={rated}
          total={cards.length}
          onRestart={restart}
          kitId={kitId}
        />
      ) : current ? (
        <>
          <div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
              role="progressbar"
              aria-valuenow={index}
              aria-valuemin={0}
              aria-valuemax={cards.length}
              aria-label="Cards done in this session"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300"
                style={{ width: `${(index / cards.length) * 100}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted" aria-live="polite">
              Card {index + 1} of {cards.length}
            </p>
          </div>

          <PracticeCardView
            card={current}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onRate={rate}
          />

          <p className="text-xs text-muted">
            Space reveals the answer. Then 1, 2 or 3 rates it and moves on.
          </p>
        </>
      ) : null}

      {statsQuery.data ? <CoverageGrid stats={statsQuery.data} /> : null}
    </div>
  );
}

function SessionSummary({
  rated,
  total,
  onRestart,
  kitId,
}: {
  rated: Record<string, Confidence>;
  total: number;
  onRestart: () => void;
  kitId: string;
}) {
  const counts = { 1: 0, 2: 0, 3: 0 } as Record<Confidence, number>;
  for (const confidence of Object.values(rated)) counts[confidence] += 1;

  return (
    <Card>
      <CardBody className="space-y-4 text-center">
        <PartyPopper className="mx-auto size-8 text-brand-600" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Session complete</h2>
          <p className="mt-1 text-sm text-muted">
            {total} {total === 1 ? "card" : "cards"} reviewed. Next time starts with whatever you
            rated shaky.
          </p>
        </div>

        <dl className="mx-auto grid max-w-sm grid-cols-3 gap-2 text-sm">
          {([1, 2, 3] as Confidence[]).map((value) => (
            <div key={value} className="rounded-lg border border-line px-3 py-2">
              <dt className="text-xs text-muted">{CONFIDENCE_LABELS[value]}</dt>
              <dd className="text-lg font-semibold tabular-nums text-zinc-900">{counts[value]}</dd>
            </div>
          ))}
        </dl>

        <div className="flex justify-center gap-2">
          <Button onClick={onRestart}>
            <RotateCw className="size-4" aria-hidden />
            Go again
          </Button>
          <LinkButton href={`/kits/${kitId}`} variant="secondary">
            Back to the kit
          </LinkButton>
        </div>
      </CardBody>
    </Card>
  );
}
