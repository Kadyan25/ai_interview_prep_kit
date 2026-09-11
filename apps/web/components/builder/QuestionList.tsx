"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useEffect, useRef, useState } from "react";
import type { ItemStateMap, KitBody, Op, Question, QuestionCategory } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddQuestionForm } from "./AddQuestionForm";
import { QuestionCard } from "./QuestionCard";
import { cn } from "@/lib/cn";

const CATEGORIES: { id: QuestionCategory; label: string }[] = [
  { id: "technical", label: "Technical" },
  { id: "behavioural", label: "Behavioural" },
  { id: "system-design", label: "System design" },
  { id: "company-fit", label: "Company fit" },
];

export function QuestionList({
  body,
  itemState,
  onApply,
  locked,
  regenerateAction,
  focusQuestionId,
}: {
  body: KitBody;
  itemState: ItemStateMap;
  onApply: (ops: Op[]) => void;
  locked: boolean;
  regenerateAction: (category: QuestionCategory) => React.ReactNode;
  /** Set when the user clicked a question in the schedule. */
  focusQuestionId?: string | null;
}) {
  const [category, setCategory] = useState<QuestionCategory>("technical");
  const listRef = useRef<HTMLUListElement>(null);
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Keyboard reorder: focus the handle, press space, arrow, space again.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const inCategory = body.questions.filter((q) => q.category === category);
  const ids = inCategory.map((q) => q.id);

  // Following a link from the schedule switches to the right category and
  // brings the question into view, rather than dropping the user at the top.
  useEffect(() => {
    if (!focusQuestionId) return;
    const target = body.questions.find((q) => q.id === focusQuestionId);
    if (!target) return;
    setCategory(target.category);
    const timer = setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-question-id="${focusQuestionId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(timer);
  }, [focusQuestionId, body.questions]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onApply([{ op: "reorder_questions", category, ids: arrayMove(ids, from, to) }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {CATEGORIES.map((c) => {
            const count = body.questions.filter((q) => q.category === c.id).length;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  category === c.id
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-line bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {c.label} <span className="text-muted">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={locked}>
            Add a question
          </Button>
          {regenerateAction(category)}
        </div>
      </div>

      {locked ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          These questions are being regenerated. Everything else on this page is still editable.
        </p>
      ) : null}

      {inCategory.length === 0 ? (
        <EmptyState
          title={`No ${CATEGORIES.find((c) => c.id === category)?.label.toLowerCase()} questions`}
          description="Either the posting had nothing to hang them on, or they were all removed. Add one, or regenerate the category."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul ref={listRef} className="space-y-3">
              {inCategory.map((question) => (
                <li
                  key={question.id}
                  data-question-id={question.id}
                  className={
                    question.id === focusQuestionId
                      ? "rounded-xl ring-2 ring-brand-300 ring-offset-2"
                      : undefined
                  }
                >
                  <QuestionCard
                    question={question}
                    state={itemState[question.id]}
                    requirements={body.role.requirements}
                    onApply={onApply}
                    onDelete={setPendingDelete}
                    locked={locked}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <AddQuestionForm
        open={adding}
        category={category}
        requirements={body.role.requirements}
        onClose={() => setAdding(false)}
        onAdd={(question) => {
          onApply([{ op: "add_question", question }]);
          setAdding(false);
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this question?"
        description={
          pendingDelete
            ? `"${pendingDelete.prompt.slice(0, 90)}". It is removed from the schedule too.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onApply([{ op: "delete_question", id: pendingDelete.id }]);
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
