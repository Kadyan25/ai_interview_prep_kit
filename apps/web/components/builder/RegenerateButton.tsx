"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { QuestionCategory } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

type Section = "brief" | "category" | "schedule";

/**
 * The dialog says exactly what survives. Regeneration is the one action here
 * that throws work away, so it should never be a surprise.
 */
const COPY: Record<Section, { title: string; keeps: string[]; replaces: string[] }> = {
  brief: {
    title: "Rewrite the company brief?",
    replaces: ["The summary, what they do, and how they hire"],
    keeps: ["Every question, flashcard and schedule day", "Any requirement you edited"],
  },
  category: {
    title: "Regenerate these questions?",
    replaces: ["Questions in this category that you have not touched"],
    keeps: [
      "Questions you edited, wrote yourself, or pinned",
      "Every other category",
      "Your flashcards and the brief",
    ],
  },
  schedule: {
    title: "Re-plan the schedule?",
    replaces: ["Which questions land on which day, and the minutes per day"],
    keeps: ["Every question, flashcard and requirement, exactly as they are"],
  },
};

export function RegenerateButton({
  kitId,
  section,
  category,
  label,
  disabled,
}: {
  kitId: string;
  section: Section;
  category?: QuestionCategory;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const copy = COPY[section];

  const regenerate = useMutation({
    mutationFn: () => api.regenerate(kitId, section, category),
    onSuccess: async () => {
      setOpen(false);
      toast("Regenerating. The rest of the page stays editable.", "success");
      await queryClient.invalidateQueries({ queryKey: ["job", kitId] });
      await queryClient.invalidateQueries({ queryKey: ["kit", kitId] });
    },
    onError: (error) => {
      setOpen(false);
      toast(
        error instanceof ApiError ? error.message : "Could not start regeneration.",
        "error",
      );
    },
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <RefreshCw className="size-4" aria-hidden />
        {label ?? "Regenerate"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Regenerate
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">
              Replaced
            </h3>
            <ul className="space-y-1 text-zinc-700">
              {copy.replaces.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-zinc-300">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Kept
            </h3>
            <ul className="space-y-1 text-zinc-700">
              {copy.keeps.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-zinc-300">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Dialog>
    </>
  );
}
