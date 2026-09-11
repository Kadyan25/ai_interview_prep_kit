"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BriefSection } from "@/components/kits/sections/BriefSection";
import { FlashcardsSection } from "@/components/kits/sections/FlashcardsSection";
import { KitStatusBadge } from "@/components/kits/KitStatusBadge";
import { ProgressPanel } from "@/components/kits/ProgressPanel";
import { QuestionsSection } from "@/components/kits/sections/QuestionsSection";
import { RoleSection } from "@/components/kits/sections/RoleSection";
import { ScheduleSection } from "@/components/kits/sections/ScheduleSection";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { api } from "@/lib/api";

export default function KitPage() {
  const params = useParams<{ id: string }>();
  const kitId = params.id;
  const [tab, setTab] = useState("brief");

  const kitQuery = useQuery({
    queryKey: ["kit", kitId],
    queryFn: () => api.getKit(kitId).then((r) => r.kit),
    // While a kit is generating the body arrives from the server, not from here.
    refetchInterval: (query) => (query.state.data?.status === "generating" ? 2500 : false),
  });

  if (kitQuery.isPending) return <SkeletonList rows={4} />;

  if (kitQuery.isError) {
    return (
      <EmptyState
        title="Could not load this kit"
        description="It may have been deleted, or the API may still be waking up."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => kitQuery.refetch()}>
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

  const kit = kitQuery.data;
  const body = kit.body;

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
        <KitStatusBadge status={kit.status} />
      </div>

      {kit.status === "generating" || kit.status === "failed" ? (
        <ProgressPanel kitId={kitId} />
      ) : null}

      {body ? (
        <>
          {body.warnings && body.warnings.length > 0 ? <WarningsBanner warnings={body.warnings} /> : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "brief", label: "Brief", content: <BriefSection body={body} /> },
              {
                id: "role",
                label: "Role",
                count: body.role.requirements.length,
                content: <RoleSection body={body} />,
              },
              {
                id: "questions",
                label: "Questions",
                count: body.questions.length,
                content: <QuestionsSection body={body} />,
              },
              {
                id: "flashcards",
                label: "Flashcards",
                count: body.flashcards.length,
                content: <FlashcardsSection body={body} />,
              },
              {
                id: "schedule",
                label: "Schedule",
                count: body.schedule.days.length,
                content: <ScheduleSection body={body} />,
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
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
