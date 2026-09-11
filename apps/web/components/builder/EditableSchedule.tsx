"use client";

import { Clock, X } from "lucide-react";
import type { ItemStateMap, KitBody, Op } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { InlineEdit } from "./InlineEdit";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function EditableSchedule({
  body,
  itemState,
  onApply,
  locked,
  action,
  todayDay,
  onOpenQuestion,
}: {
  body: KitBody;
  itemState: ItemStateMap;
  onApply: (ops: Op[]) => void;
  locked: boolean;
  action?: React.ReactNode;
  /** Which day the user is on, counted from when the kit was created. */
  todayDay?: number;
  onOpenQuestion?: (questionId: string) => void;
}) {
  const questionById = new Map(body.questions.map((q) => [q.id, q]));
  const total = body.schedule.days.reduce((sum, day) => sum + day.minutes, 0);
  const edited = itemState.schedule?.origin === "edited";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-muted">
          {body.schedule.days_available} {body.schedule.days_available === 1 ? "day" : "days"} until
          the interview, {formatMinutes(total)} in total. The hardest questions on the must-have
          requirements come first.
          {edited ? " You have changed this plan by hand, so it is left alone when questions change." : ""}
        </p>
        <div className="flex items-center gap-2">
          {edited ? <Badge tone="green">Edited</Badge> : null}
          {action}
        </div>
      </div>

      {locked ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          The plan is being rebuilt. Everything else is still editable.
        </p>
      ) : null}

      <ol className="space-y-3">
        {body.schedule.days.map((day) => (
          <li key={day.day}>
            <Card className={day.day === todayDay ? "border-brand-300 ring-1 ring-brand-200" : undefined}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold text-zinc-900">
                    <span className="shrink-0">Day {day.day}</span>
                    {day.day === todayDay ? <Badge tone="brand">Today</Badge> : null}
                    <span className="min-w-0 flex-1 font-normal text-muted">
                      <InlineEdit
                        label={`focus for day ${day.day}`}
                        value={day.focus}
                        onSave={(focus) =>
                          onApply([{ op: "update_schedule_day", day: day.day, fields: { focus } }])
                        }
                      />
                    </span>
                  </h3>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                    <Clock className="size-3.5" aria-hidden />
                    <label className="sr-only" htmlFor={`minutes-${day.day}`}>
                      Minutes on day {day.day}
                    </label>
                    <input
                      id={`minutes-${day.day}`}
                      type="number"
                      min={0}
                      max={600}
                      step={5}
                      value={day.minutes}
                      disabled={locked}
                      onChange={(e) => {
                        const minutes = Math.max(0, Math.round(Number(e.target.value)));
                        if (!Number.isFinite(minutes)) return;
                        onApply([
                          { op: "update_schedule_day", day: day.day, fields: { minutes } },
                        ]);
                      }}
                      className="w-16 rounded border border-line bg-white px-1.5 py-0.5 text-right text-xs"
                    />
                    min
                  </span>
                </div>

                {day.question_ids.length === 0 ? (
                  <p className="text-sm text-muted">Nothing scheduled on this day.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {day.question_ids.map((id) => (
                      <li key={id} className="flex items-start gap-2 text-sm text-zinc-700">
                        <span aria-hidden className="text-zinc-300">
                          —
                        </span>
                        {onOpenQuestion ? (
                          <button
                            type="button"
                            onClick={() => onOpenQuestion(id)}
                            className="min-w-0 flex-1 text-left line-clamp-2 hover:text-brand-700 hover:underline"
                          >
                            {questionById.get(id)?.prompt ?? id}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 line-clamp-2">
                            {questionById.get(id)?.prompt ?? id}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            onApply([
                              {
                                op: "update_schedule_day",
                                day: day.day,
                                fields: {
                                  question_ids: day.question_ids.filter((qid) => qid !== id),
                                },
                              },
                            ])
                          }
                          aria-label={`Remove this question from day ${day.day}`}
                          className="shrink-0 rounded p-0.5 text-zinc-300 hover:bg-zinc-100 hover:text-red-600"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
