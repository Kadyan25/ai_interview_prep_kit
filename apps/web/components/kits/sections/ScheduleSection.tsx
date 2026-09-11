import { Clock } from "lucide-react";
import type { KitBody } from "@prep/shared";
import { Card, CardBody } from "@/components/ui/Card";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function ScheduleSection({ body }: { body: KitBody }) {
  const questionById = new Map(body.questions.map((q) => [q.id, q]));
  const total = body.schedule.days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {body.schedule.days_available} {body.schedule.days_available === 1 ? "day" : "days"} until
        the interview, {formatMinutes(total)} of work in total. The hardest questions on the
        must-have requirements come first.
      </p>

      <ol className="space-y-3">
        {body.schedule.days.map((day) => (
          <li key={day.day}>
            <Card>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Day {day.day}
                    <span className="ml-2 font-normal text-muted">{day.focus}</span>
                  </h3>
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Clock className="size-3.5" aria-hidden />
                    {formatMinutes(day.minutes)}
                  </span>
                </div>

                {day.question_ids.length === 0 ? (
                  <p className="text-sm text-muted">Nothing scheduled.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {day.question_ids.map((id) => {
                      const question = questionById.get(id);
                      return (
                        <li key={id} className="flex gap-2 text-sm text-zinc-700">
                          <span aria-hidden className="text-zinc-300">
                            —
                          </span>
                          <span className="line-clamp-2">{question?.prompt ?? id}</span>
                        </li>
                      );
                    })}
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
