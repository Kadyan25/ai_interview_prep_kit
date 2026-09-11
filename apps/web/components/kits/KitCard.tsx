"use client";

import Link from "next/link";
import { AlertTriangle, CalendarDays, MessageSquareText, Trash2 } from "lucide-react";
import type { KitSummary } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { KitStatusBadge } from "./KitStatusBadge";

export function KitCard({
  kit,
  onDelete,
}: {
  kit: KitSummary;
  onDelete: (kit: KitSummary) => void;
}) {
  return (
    <div className="group relative rounded-xl border border-line bg-white p-4 shadow-sm transition-shadow focus-within:shadow-md hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-900">
            <Link href={`/kits/${kit.id}`} className="before:absolute before:inset-0">
              {kit.role}
            </Link>
          </h2>
          <p className="truncate text-sm text-muted">{kit.company}</p>
        </div>
        <KitStatusBadge status={kit.status} />
      </div>

      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <div className="flex items-center gap-1">
          <CalendarDays className="size-3.5" aria-hidden />
          <dt className="sr-only">Days until interview</dt>
          <dd>
            {kit.days} {kit.days === 1 ? "day" : "days"}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <MessageSquareText className="size-3.5" aria-hidden />
          <dt className="sr-only">Questions</dt>
          <dd>{kit.questionCount} questions</dd>
        </div>
        {kit.warningCount > 0 ? (
          <div className="flex items-center gap-1 text-amber-700">
            <AlertTriangle className="size-3.5" aria-hidden />
            <dt className="sr-only">Warnings</dt>
            <dd>
              {kit.warningCount} {kit.warningCount === 1 ? "note" : "notes"}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="pointer-events-none absolute right-3 bottom-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          className="pointer-events-auto relative text-zinc-400 hover:text-red-600"
          onClick={() => onDelete(kit)}
          aria-label={`Delete kit for ${kit.role} at ${kit.company}`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
