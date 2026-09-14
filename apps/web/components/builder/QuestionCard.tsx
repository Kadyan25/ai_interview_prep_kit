"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pin, PinOff, Trash2 } from "lucide-react";
import type { ItemState, Op, Question, QuestionCategory, Requirement } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InlineEdit } from "./InlineEdit";
import { cn } from "@/lib/cn";

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

const CATEGORIES = Object.keys(CATEGORY_LABEL) as QuestionCategory[];

/**
 * Mirrors the kit schema: only company-fit questions may stand without a
 * requirement, so a question with none can move there and nowhere else.
 */
function canMoveTo(question: Question, category: QuestionCategory): boolean {
  return (
    category === question.category ||
    category === "company-fit" ||
    question.requirement_ids.length > 0
  );
}

const DIFFICULTIES:{ value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: "Warm-up" },
  { value: 2, label: "Standard" },
  { value: 3, label: "Hardest" },
];

export function QuestionCard({
  question,
  state,
  requirements,
  onApply,
  onDelete,
  locked,
}: {
  question: Question;
  state: ItemState | undefined;
  requirements: Requirement[];
  onApply: (ops: Op[]) => void;
  onDelete: (question: Question) => void;
  locked: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
    disabled: locked,
  });

  const requirementText = new Map(requirements.map((r) => [r.id, r.text]));
  const pinned = state?.pinned ?? false;
  const origin = state?.origin ?? "generated";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm",
        isDragging ? "z-10 border-brand-300 opacity-90 shadow-lg" : "border-line",
        locked && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={locked}
          aria-label={`Reorder: ${question.prompt.slice(0, 60)}. Press space, then use the arrow keys.`}
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-not-allowed"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 text-sm font-medium text-zinc-900">
              <InlineEdit
                label="question prompt"
                value={question.prompt}
                multiline
                onSave={(prompt) =>
                  onApply([{ op: "update_question", id: question.id, fields: { prompt } }])
                }
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {origin !== "generated" ? (
                <Badge tone={origin === "manual" ? "brand" : "green"}>
                  {origin === "manual" ? "Yours" : "Edited"}
                </Badge>
              ) : null}
              {pinned ? <Badge tone="amber">Pinned</Badge> : null}
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              What a strong answer covers
            </h4>
            <div className="text-sm leading-relaxed text-zinc-700">
              <InlineEdit
                label="answer outline"
                value={question.answer_outline}
                multiline
                onSave={(answer_outline) =>
                  onApply([{ op: "update_question", id: question.id, fields: { answer_outline } }])
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label className="sr-only" htmlFor={`category-${question.id}`}>
              Move to category
            </label>
            <select
              id={`category-${question.id}`}
              value={question.category}
              disabled={locked}
              onChange={(e) =>
                onApply([
                  {
                    op: "move_question",
                    id: question.id,
                    category: e.target.value as QuestionCategory,
                    // Past the end is clamped by the reducer: the question lands last.
                    index: Number.MAX_SAFE_INTEGER,
                  },
                ])
              }
              className="rounded-full border border-line bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700"
            >
              {CATEGORIES.map((category) => (
                <option
                  key={category}
                  value={category}
                  disabled={!canMoveTo(question, category)}
                >
                  {CATEGORY_LABEL[category]}
                  {canMoveTo(question, category) ? "" : " (needs a requirement)"}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor={`difficulty-${question.id}`}>
              Difficulty
            </label>
            <select
              id={`difficulty-${question.id}`}
              value={question.difficulty}
              disabled={locked}
              onChange={(e) =>
                onApply([
                  {
                    op: "update_question",
                    id: question.id,
                    fields: { difficulty: Number(e.target.value) as 1 | 2 | 3 },
                  },
                ])
              }
              className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-zinc-700"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>

            {question.requirement_ids.map((id) => (
              <Badge key={id} tone="brand">
                {requirementText.get(id) ?? id}
              </Badge>
            ))}

            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => onApply([{ op: pinned ? "unpin" : "pin", id: question.id }])}
                aria-pressed={pinned}
                title={
                  pinned
                    ? "Unpin so regenerating this category can replace it"
                    : "Pin so regenerating this category leaves it alone"
                }
              >
                {pinned ? (
                  <PinOff className="size-4" aria-hidden />
                ) : (
                  <Pin className="size-4" aria-hidden />
                )}
                <span className="sr-only">{pinned ? "Unpin question" : "Pin question"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                className="text-zinc-400 hover:text-red-600"
                onClick={() => onDelete(question)}
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Delete question</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
