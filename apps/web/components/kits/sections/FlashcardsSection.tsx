"use client";

import { useState } from "react";
import type { KitBody } from "@prep/shared";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export function FlashcardsSection({ body }: { body: KitBody }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (body.flashcards.length === 0) {
    return (
      <EmptyState
        title="No flashcards in this kit"
        description="They could not be generated on this run. Everything else is unaffected."
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {body.flashcards.map((card) => {
        const open = revealed.has(card.id);
        return (
          <li key={card.id}>
            <Card>
              <CardBody>
                <button
                  type="button"
                  onClick={() => toggle(card.id)}
                  aria-expanded={open}
                  className="w-full text-left"
                >
                  <p className="text-sm font-medium text-zinc-900">{card.front}</p>
                  <p className="mt-1 text-xs text-muted">
                    {open ? "Click to hide the answer" : "Click to reveal the answer"}
                  </p>
                </button>
                {open ? (
                  <p className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-zinc-700">
                    {card.back}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
