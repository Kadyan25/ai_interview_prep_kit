"use client";

import type { ItemStateMap, KitBody, Op, Requirement } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineEdit } from "./InlineEdit";

export function EditableRole({
  body,
  itemState,
  onApply,
}: {
  body: KitBody;
  itemState: ItemStateMap;
  onApply: (ops: Op[]) => void;
}) {
  const uncovered = new Set(body.coverage.uncovered_requirement_ids);
  const musts = body.role.requirements.filter((r) => r.priority === "must");
  const nices = body.role.requirements.filter((r) => r.priority === "nice");

  const row = (requirement: Requirement) => (
    <li
      key={requirement.id}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2"
    >
      <div className="min-w-0 flex-1 text-sm text-zinc-800">
        <InlineEdit
          label="requirement"
          value={requirement.text}
          onSave={(text) =>
            onApply([{ op: "update_requirement", id: requirement.id, fields: { text } }])
          }
        />
      </div>

      <label className="sr-only" htmlFor={`kind-${requirement.id}`}>
        Requirement kind
      </label>
      <select
        id={`kind-${requirement.id}`}
        value={requirement.kind}
        onChange={(e) =>
          onApply([
            {
              op: "update_requirement",
              id: requirement.id,
              fields: { kind: e.target.value as Requirement["kind"] },
            },
          ])
        }
        className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-zinc-700"
      >
        <option value="technical">Technical</option>
        <option value="behavioural">Behavioural</option>
        <option value="domain">Domain</option>
      </select>

      <label className="sr-only" htmlFor={`priority-${requirement.id}`}>
        Requirement priority
      </label>
      <select
        id={`priority-${requirement.id}`}
        value={requirement.priority}
        onChange={(e) =>
          onApply([
            {
              op: "update_requirement",
              id: requirement.id,
              fields: { priority: e.target.value as Requirement["priority"] },
            },
          ])
        }
        className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-zinc-700"
      >
        <option value="must">Must have</option>
        <option value="nice">Nice to have</option>
      </select>

      {itemState[requirement.id]?.origin === "edited" ? <Badge tone="green">Edited</Badge> : null}
      {uncovered.has(requirement.id) ? <Badge tone="amber">No question covers this</Badge> : null}
    </li>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={body.role.title}
          description={[body.role.seniority, body.source.location].filter(Boolean).join(" · ")}
        />
        <CardBody>
          {body.role.responsibilities.length === 0 ? (
            <p className="text-sm text-muted">
              The posting did not spell out day-to-day responsibilities.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm text-zinc-700">
              {body.role.responsibilities.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-zinc-300">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Requirements"
          description="Each one was quoted from the posting. Change a priority here and the schedule will weight it differently next time you re-plan."
        />
        <CardBody className="space-y-5">
          {body.role.requirements.length === 0 ? (
            <EmptyState
              title="Nothing could be quoted from this posting"
              description="The kit covers general ground for the role title instead of inventing requirements."
            />
          ) : (
            <>
              {musts.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Must have <span className="font-normal">({musts.length})</span>
                  </h3>
                  <ul className="space-y-2">{musts.map(row)}</ul>
                </div>
              ) : null}
              {nices.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Nice to have <span className="font-normal">({nices.length})</span>
                  </h3>
                  <ul className="space-y-2">{nices.map(row)}</ul>
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
