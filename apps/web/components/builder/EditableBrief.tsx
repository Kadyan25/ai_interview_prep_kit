"use client";

import { ExternalLink } from "lucide-react";
import type { ItemStateMap, KitBody, Op } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineEdit } from "./InlineEdit";

export function EditableBrief({
  body,
  itemState,
  onApply,
  locked,
  action,
}: {
  body: KitBody;
  itemState: ItemStateMap;
  onApply: (ops: Op[]) => void;
  locked: boolean;
  action?: React.ReactNode;
}) {
  const brief = body.company_brief;
  const edited = itemState.company_brief?.origin === "edited";

  const update = (fields: { summary?: string; what_they_do?: string; how_they_hire?: string }) =>
    onApply([{ op: "update_brief", fields }]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {body.source.company}
              {edited ? <Badge tone="green">Edited</Badge> : null}
            </span>
          }
          description={body.source.company_url || undefined}
          action={action}
        />
        <CardBody className="space-y-4 text-sm leading-relaxed text-zinc-700">
          {locked ? (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              The brief is being rewritten. The rest of the kit is still editable.
            </p>
          ) : null}

          <Field label="Summary" value={brief.summary} onSave={(summary) => update({ summary })} />
          <Field
            label="What they do"
            value={brief.what_they_do}
            onSave={(what_they_do) => update({ what_they_do })}
          />
          <Field
            label="How they hire"
            value={brief.how_they_hire ?? ""}
            onSave={(how_they_hire) => update({ how_they_hire })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sources"
          description="Every page this brief was built from. Nothing here came from anywhere else."
        />
        <CardBody>
          {brief.sources.length === 0 ? (
            <EmptyState
              title="No sources"
              description="The company site could not be read, so this brief comes from the job description alone."
            />
          ) : (
            <ul className="space-y-1.5">
              {brief.sources.map((source) => (
                <li key={source}>
                  <a
                    href={source}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 break-all text-sm text-brand-700 hover:underline"
                  >
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    {source}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
      <InlineEdit label={label.toLowerCase()} value={value} multiline onSave={onSave} />
    </div>
  );
}
