"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { KitSummary } from "@prep/shared";
import { KitCard } from "@/components/kits/KitCard";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

/** Says what actually went wrong, since "try again" only helps for some failures. */
function loadErrorMessage(error: Error | null): string {
  if (!(error instanceof ApiError)) return "Something unexpected went wrong. Try again.";
  if (error.status === 0) return "Could not reach the server. Check your connection and try again.";
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    return "The API is not responding yet. On the free tier it can take up to a minute to wake up, so try again shortly.";
  }
  if (error.status === 401) return "Your session expired. Taking you to sign in.";
  return error.message;
}

export default function KitsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingDelete, setPendingDelete] = useState<KitSummary | null>(null);

  const kitsQuery = useQuery({
    queryKey: ["kits"],
    queryFn: () => api.listKits().then((r) => r.kits),
    // A kit being generated changes status without any user action.
    refetchInterval: (query) =>
      query.state.data?.some((k) => k.status === "generating") ? 3000 : false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKit(id),
    onSuccess: async () => {
      setPendingDelete(null);
      toast("Kit deleted.", "success");
      await queryClient.invalidateQueries({ queryKey: ["kits"] });
    },
    onError: () => toast("Could not delete that kit. Try again.", "error"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">My kits</h1>
          <p className="text-sm text-muted">Everything you are preparing for, in one place.</p>
        </div>
        <LinkButton href="/kits/new" className="hidden sm:inline-flex">
          <Plus className="size-4" aria-hidden />
          New kit
        </LinkButton>
      </div>

      {kitsQuery.isPending ? <SkeletonList rows={3} /> : null}

      {kitsQuery.isError ? (
        <EmptyState
          title="Could not load your kits"
          description={loadErrorMessage(kitsQuery.error)}
          action={
            <Button variant="secondary" onClick={() => kitsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {kitsQuery.data && kitsQuery.data.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" aria-hidden />}
          title="No kits yet"
          description="Paste a job description and a company URL, and you get a brief, a question bank and a day-by-day plan."
          action={<LinkButton href="/kits/new">Create your first kit</LinkButton>}
        />
      ) : null}

      {kitsQuery.data && kitsQuery.data.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {kitsQuery.data.map((kit) => (
            <li key={kit.id}>
              <KitCard kit={kit} onDelete={setPendingDelete} />
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this kit?"
        description={
          pendingDelete
            ? `${pendingDelete.role} at ${pendingDelete.company}. Your edits and practice history for it go too. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
