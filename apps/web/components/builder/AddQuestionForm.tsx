"use client";

import { useEffect, useState } from "react";
import type { QuestionCategory, Requirement } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";

export type NewQuestion = {
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
};

export function AddQuestionForm({
  open,
  category,
  requirements,
  onClose,
  onAdd,
}: {
  open: boolean;
  category: QuestionCategory;
  requirements: Requirement[];
  onClose: () => void;
  onAdd: (question: NewQuestion) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState("");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPrompt("");
      setOutline("");
      setDifficulty(2);
      setSelected([]);
      setError(null);
    }
  }, [open]);

  // Every category except company-fit has to point at a requirement, or the
  // coverage check has nothing to measure it against.
  const needsRequirement = category !== "company-fit" && requirements.length > 0;

  const submit = () => {
    if (prompt.trim().length === 0 || outline.trim().length === 0) {
      setError("A question needs both a prompt and an outline.");
      return;
    }
    if (needsRequirement && selected.length === 0) {
      setError("Pick at least one requirement this question tests.");
      return;
    }
    onAdd({
      requirement_ids: selected,
      category,
      prompt: prompt.trim(),
      answer_outline: outline.trim(),
      difficulty,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a question"
      description="Yours to keep: regenerating this category will not touch it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Add question</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="Question"
          placeholder="How would you…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-20"
        />
        <Textarea
          label="What a strong answer covers"
          placeholder="The points you want to remember to make."
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
          className="min-h-20"
        />

        <div className="space-y-1.5">
          <label htmlFor="new-difficulty" className="block text-sm font-medium text-zinc-800">
            Difficulty
          </label>
          <select
            id="new-difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3)}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value={1}>Warm-up</option>
            <option value={2}>Standard</option>
            <option value={3}>Hardest</option>
          </select>
        </div>

        {requirements.length > 0 ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-800">
              Requirements this tests {needsRequirement ? "" : "(optional)"}
            </legend>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {requirements.map((requirement) => (
                <label key={requirement.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(requirement.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, requirement.id]
                          : current.filter((id) => id !== requirement.id),
                      )
                    }
                  />
                  <span className="text-zinc-700">{requirement.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
