"use client";

import { useState } from "react";
import type { KitBody, QuestionCategory } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

const ORDER: QuestionCategory[] = ["technical", "behavioural", "system-design", "company-fit"];

const DIFFICULTY_LABEL: Record<number, string> = {
  1: "Warm-up",
  2: "Standard",
  3: "Hardest",
};

export function QuestionsSection({ body }: { body: KitBody }) {
  const [category, setCategory] = useState<QuestionCategory | "all">("all");

  const requirementText = new Map(body.role.requirements.map((r) => [r.id, r.text]));
  const counts = ORDER.map((c) => ({
    category: c,
    count: body.questions.filter((q) => q.category === c).length,
  })).filter((entry) => entry.count > 0);

  const visible =
    category === "all" ? body.questions : body.questions.filter((q) => q.category === category);

  if (body.questions.length === 0) {
    return (
      <EmptyState
        title="No questions were generated"
        description="Every category was skipped or failed on this run. Regenerating usually fixes it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={category === "all"} onClick={() => setCategory("all")}>
          All <span className="text-muted">{body.questions.length}</span>
        </FilterChip>
        {counts.map(({ category: c, count }) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABEL[c]} <span className="text-muted">{count}</span>
          </FilterChip>
        ))}
      </div>

      <ul className="space-y-3">
        {visible.map((question) => (
          <li key={question.id}>
            <Card>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex-1 text-sm font-medium text-zinc-900">{question.prompt}</p>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone="neutral">{CATEGORY_LABEL[question.category]}</Badge>
                    <Badge tone={question.difficulty === 3 ? "amber" : "neutral"}>
                      {DIFFICULTY_LABEL[question.difficulty]}
                    </Badge>
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    What a strong answer covers
                  </h3>
                  <p className="text-sm leading-relaxed text-zinc-700">{question.answer_outline}</p>
                </div>

                {question.requirement_ids.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                    {question.requirement_ids.map((id) => (
                      <Badge key={id} tone="brand">
                        {requirementText.get(id) ?? id}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-line bg-white text-zinc-600 hover:bg-zinc-50",
      )}
    >
      {children}
    </button>
  );
}
