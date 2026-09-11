"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Flashcard, ItemStateMap, KitBody, Op } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/Field";
import { InlineEdit } from "./InlineEdit";

export function FlashcardEditor({
  body,
  itemState,
  onApply,
}: {
  body: KitBody;
  itemState: ItemStateMap;
  onApply: (ops: Op[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Flashcard | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (front.trim().length === 0 || back.trim().length === 0) {
      setError("A card needs both a front and a back.");
      return;
    }
    onApply([
      {
        op: "add_flashcard",
        flashcard: { front: front.trim(), back: back.trim(), requirement_ids: [] },
      },
    ]);
    setFront("");
    setBack("");
    setError(null);
    setAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Click any side to rewrite it. Cards you add are yours and are never replaced.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Add a card
        </Button>
      </div>

      {body.flashcards.length === 0 ? (
        <EmptyState
          title="No flashcards in this kit"
          description="They could not be generated on this run, or you removed them all. You can write your own."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {body.flashcards.map((card) => (
            <li key={card.id}>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 text-sm font-medium text-zinc-900">
                      <InlineEdit
                        label="flashcard front"
                        value={card.front}
                        multiline
                        onSave={(front) =>
                          onApply([{ op: "update_flashcard", id: card.id, fields: { front } }])
                        }
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {itemState[card.id]?.origin === "manual" ? (
                        <Badge tone="brand">Yours</Badge>
                      ) : itemState[card.id]?.origin === "edited" ? (
                        <Badge tone="green">Edited</Badge>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() => setPendingDelete(card)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="sr-only">Delete card</span>
                      </Button>
                    </div>
                  </div>
                  <div className="border-t border-line pt-3 text-sm leading-relaxed text-zinc-700">
                    <InlineEdit
                      label="flashcard back"
                      value={card.back}
                      multiline
                      onSave={(back) =>
                        onApply([{ op: "update_flashcard", id: card.id, fields: { back } }])
                      }
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a flashcard"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={add}>Add card</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textarea
            label="Front"
            placeholder="The prompt you want to answer out loud."
            value={front}
            onChange={(e) => setFront(e.target.value)}
            className="min-h-20"
          />
          <Textarea
            label="Back"
            placeholder="The answer, in two or three sentences."
            value={back}
            onChange={(e) => setBack(e.target.value)}
            className="min-h-20"
          />
          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this card?"
        description={pendingDelete?.front.slice(0, 100)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onApply([{ op: "delete_flashcard", id: pendingDelete.id }]);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
