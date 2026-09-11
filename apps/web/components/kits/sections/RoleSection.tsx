import type { KitBody } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

const KIND_LABEL: Record<string, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  domain: "Domain",
};

export function RoleSection({ body }: { body: KitBody }) {
  const uncovered = new Set(body.coverage.uncovered_requirement_ids);
  const musts = body.role.requirements.filter((r) => r.priority === "must");
  const nices = body.role.requirements.filter((r) => r.priority === "nice");

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
          description="Every one of these was quoted from the posting. Anything that could not be quoted was dropped."
        />
        <CardBody className="space-y-5">
          {body.role.requirements.length === 0 ? (
            <EmptyState
              title="Nothing could be quoted from this posting"
              description="The kit covers general ground for the role title instead of inventing requirements."
            />
          ) : (
            <>
              <RequirementGroup
                title="Must have"
                requirements={musts}
                uncovered={uncovered}
                tone="brand"
              />
              <RequirementGroup
                title="Nice to have"
                requirements={nices}
                uncovered={uncovered}
                tone="neutral"
              />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function RequirementGroup({
  title,
  requirements,
  uncovered,
  tone,
}: {
  title: string;
  requirements: KitBody["role"]["requirements"];
  uncovered: Set<string>;
  tone: "brand" | "neutral";
}) {
  if (requirements.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title} <span className="font-normal">({requirements.length})</span>
      </h3>
      <ul className="space-y-2">
        {requirements.map((requirement) => (
          <li
            key={requirement.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2"
          >
            <span className="flex-1 text-sm text-zinc-800">{requirement.text}</span>
            <Badge tone={tone}>{KIND_LABEL[requirement.kind] ?? requirement.kind}</Badge>
            {uncovered.has(requirement.id) ? (
              <Badge tone="amber">No question covers this</Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
