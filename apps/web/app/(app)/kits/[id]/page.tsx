"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Dumbbell } from "lucide-react";
import type { QuestionCategory } from "@prep/shared";
import { EditableBrief } from "@/components/builder/EditableBrief";
import { EditableRole } from "@/components/builder/EditableRole";
import { EditableSchedule } from "@/components/builder/EditableSchedule";
import { FlashcardEditor } from "@/components/builder/FlashcardEditor";
import { QuestionList } from "@/components/builder/QuestionList";
import { RegenerateButton } from "@/components/builder/RegenerateButton";
import { SaveIndicator } from "@/components/builder/SaveIndicator";
import { KitStatusBadge } from "@/components/kits/KitStatusBadge";
import { ProgressPanel } from "@/components/kits/ProgressPanel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api";
import { useKitDraft } from "@/lib/useKitDraft";

/** Which job types hold the pen on which section. Mirrors the server's rule. */
const LOCKS: Record<string, string[]> = {
  full: ["brief", "questions", "flashcards", "role", "schedule"],
  regen_brief: ["brief"],
  regen_category: ["questions"],
  regen_schedule: ["schedule"],
};

export default function KitPage() {
  const params = useParams<{ id: string }>();
  const kitId = params.id;
  const [tab, setTab] = useState("brief");
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(null);

  const draft = useKitDraft(kitId);

  // The job is polled separately so a regeneration running in one section does
  // not stop the user editing another.
  const jobQuery = useQuery({
    queryKey: ["job", kitId],
    queryFn: () => api.getJob(kitId).then((r) => r.job),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    },
  });

  const job = jobQuery.data;
  const jobRunning = job?.status === "queued" || job?.status === "running";
  const locked = jobRunning ? (LOCKS[job.type] ?? []) : [];
  const isLocked = (section: string) => locked.includes(section);

  if (draft.isPending) return <SkeletonList rows={4} />;

  if (draft.isError || !draft.kit) {
    return (
      <EmptyState
        title="Could not load this kit"
        description="It may have been deleted, or the API may still be waking up."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => draft.refresh()}>
              Try again
            </Button>
            <LinkButton href="/kits" variant="secondary">
              Back to my kits
            </LinkButton>
          </div>
        }
      />
    );
  }

  const kit = draft.kit;
  const state = draft.state;
  const body = state?.body;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-zinc-900">
            {body?.role.title ?? "Preparing your kit"}
          </h1>
          <p className="text-sm text-muted">
            {body?.source.company ?? kit.input.companyUrl ?? "—"}
            {body ? ` · ${body.schedule.days_available} day plan` : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={draft.saveState} error={draft.saveError} />
          <KitStatusBadge status={kit.status} />
          {body && body.flashcards.length > 0 ? (
            <LinkButton href={`/kits/${kitId}/practice`}>
              <Dumbbell className="size-4" aria-hidden />
              Practice
            </LinkButton>
          ) : null}
        </div>
      </div>

      {kit.status === "generating" || kit.status === "failed" ? (
        <ProgressPanel kitId={kitId} />
      ) : null}

      {body && state ? (
        <>
          {body.warnings && body.warnings.length > 0 ? (
            <WarningsBanner warnings={body.warnings} />
          ) : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              {
                id: "brief",
                label: "Brief",
                content: (
                  <EditableBrief
                    body={body}
                    itemState={state.itemState}
                    onApply={draft.apply}
                    locked={isLocked("brief")}
                    action={
                      <RegenerateButton
                        kitId={kitId}
                        section="brief"
                        label="Rewrite"
                        disabled={jobRunning}
                      />
                    }
                  />
                ),
              },
              {
                id: "role",
                label: "Role",
                count: body.role.requirements.length,
                content: (
                  <EditableRole body={body} itemState={state.itemState} onApply={draft.apply} />
                ),
              },
              {
                id: "questions",
                label: "Questions",
                count: body.questions.length,
                content: (
                  <QuestionList
                    body={body}
                    itemState={state.itemState}
                    onApply={draft.apply}
                    locked={isLocked("questions")}
                    focusQuestionId={focusQuestionId}
                    regenerateAction={(category: QuestionCategory) => (
                      <RegenerateButton
                        kitId={kitId}
                        section="category"
                        category={category}
                        disabled={jobRunning}
                      />
                    )}
                  />
                ),
              },
              {
                id: "flashcards",
                label: "Flashcards",
                count: body.flashcards.length,
                content: (
                  <FlashcardEditor
                    body={body}
                    itemState={state.itemState}
                    onApply={draft.apply}
                  />
                ),
              },
              {
                id: "schedule",
                label: "Schedule",
                count: body.schedule.days.length,
                content: (
                  <EditableSchedule
                    body={body}
                    itemState={state.itemState}
                    onApply={draft.apply}
                    locked={isLocked("schedule")}
                    todayDay={dayOfPlan(kit.createdAt, body.schedule.days_available)}
                    onOpenQuestion={(questionId) => {
                      setFocusQuestionId(questionId);
                      setTab("questions");
                    }}
                    action={
                      <RegenerateButton
                        kitId={kitId}
                        section="schedule"
                        label="Re-plan"
                        disabled={jobRunning}
                      />
                    }
                  />
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Which day of the plan the user is on, counted from when the kit was made.
 * Returns undefined once the plan has run out, rather than pointing at a day
 * that has already passed.
 */
function dayOfPlan(createdAt: string, daysAvailable: number): number | undefined {
  const start = new Date(createdAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const elapsed = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  const day = elapsed + 1;
  return day >= 1 && day <= daysAvailable ? day : undefined;
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <AlertTriangle className="size-4" aria-hidden />
        What this kit could not do
      </h2>
      <ul className="mt-1.5 space-y-1 text-sm text-amber-800">
        {warnings.map((warning) => (
          <li key={warning} className="flex gap-2">
            <span aria-hidden className="text-amber-400">
              —
            </span>
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}
