import { ExternalLink } from "lucide-react";
import type { KitBody } from "@prep/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export function BriefSection({ body }: { body: KitBody }) {
  const brief = body.company_brief;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={body.source.company} description={body.source.company_url || undefined} />
        <CardBody className="space-y-4 text-sm leading-relaxed text-zinc-700">
          <p>{brief.summary}</p>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              What they do
            </h3>
            <p>{brief.what_they_do}</p>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              How they hire
            </h3>
            <p className="whitespace-pre-line">{brief.how_they_hire}</p>
          </div>
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
