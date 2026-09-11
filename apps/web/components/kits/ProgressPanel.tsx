"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDashed, Loader2, MinusCircle, RotateCw, X } from "lucide-react";
import type { JobDocument, StepStatus } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";

const POLL_MS = 2000;

const icons: Record<StepStatus, React.ReactNode> = {
  pending: <CircleDashed className="size-4 text-zinc-300" aria-hidden />,
  running: <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden />,
  done: <Check className="size-4 text-emerald-600" aria-hidden />,
  skipped: <MinusCircle className="size-4 text-zinc-400" aria-hidden />,
  failed: <X className="size-4 text-red-600" aria-hidden />,
};

const statusWord: Record<StepStatus, string> = {
  pending: "waiting",
  running: "in progress",
  done: "done",
  skipped: "skipped",
  failed: "failed",
};

export function ProgressPanel({ kitId }: { kitId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const jobQuery = useQuery({
    queryKey: ["job", kitId],
    queryFn: () => api.getJob(kitId).then((r) => r.job),
    // Polling stops the moment the job settles, so an idle tab makes no requests.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? POLL_MS : false;
    },
    retry: 3,
  });

  const retry = useMutation({
    mutationFn: () => api.retryKit(kitId),
    onSuccess: async () => {
      toast("Started again.", "success");
      await queryClient.invalidateQueries({ queryKey: ["job", kitId] });
      await queryClient.invalidateQueries({ queryKey: ["kit", kitId] });
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : "Could not start again.", "error"),
  });

  const job = jobQuery.data;

  if (jobQuery.isPending) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">Loading progress…</p>
        </CardBody>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">
            No generation has been recorded for this kit yet. If it was just created, give it a
            moment.
          </p>
        </CardBody>
      </Card>
    );
  }

  const done = job.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const percent = Math.round((done / Math.max(job.steps.length, 1)) * 100);

  return (
    <Card>
      <CardHeader
        title={job.status === "failed" ? "Generation failed" : "Building your kit"}
        description={
          job.status === "failed"
            ? "Nothing was saved. You can start it again."
            : "This takes about a minute. You can leave the page — progress is saved."
        }
        action={
          job.status === "failed" ? (
            <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>
              <RotateCw className="size-4" aria-hidden />
              Try again
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        <div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Generation progress"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                job.status === "failed" ? "bg-red-500" : "bg-brand-600",
              )}
              style={{ width: `${Math.max(percent, 4)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {done} of {job.steps.length} steps
          </p>
        </div>

        <ol className="space-y-1.5">
          {job.steps.map((step) => (
            <li key={step.name} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 shrink-0">{icons[step.status]}</span>
              <span className="min-w-0">
                <span
                  className={cn(
                    step.status === "pending" && "text-zinc-400",
                    step.status === "running" && "font-medium text-zinc-900",
                    (step.status === "done" || step.status === "skipped") && "text-zinc-600",
                    step.status === "failed" && "text-red-700",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only"> — {statusWord[step.status]}</span>
                {step.note ? (
                  <span className="block text-xs text-muted">{step.note}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        {job.error ? <JobError error={job.error} /> : null}
      </CardBody>
    </Card>
  );
}

function JobError({ error }: { error: NonNullable<JobDocument["error"]> }) {
  const friendly =
    error.code === "INTERRUPTED"
      ? "The server restarted while this was generating. Nothing was lost except the run itself."
      : error.code === "LLM_UNAVAILABLE"
        ? "The model provider could not be reached. This is usually temporary."
        : error.message;

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {friendly}
        <span className="mt-0.5 block font-mono text-xs text-red-600">{error.code}</span>
      </span>
    </p>
  );
}
