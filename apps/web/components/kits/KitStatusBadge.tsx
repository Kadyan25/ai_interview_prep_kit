import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { KitStatus } from "@prep/shared";
import { Badge } from "@/components/ui/Badge";

export function KitStatusBadge({ status }: { status: KitStatus }) {
  switch (status) {
    case "generating":
      return (
        <Badge tone="brand">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Generating
        </Badge>
      );
    case "ready":
      return (
        <Badge tone="green">
          <CheckCircle2 className="size-3" aria-hidden />
          Ready
        </Badge>
      );
    case "partial":
      return (
        <Badge tone="amber">
          <AlertTriangle className="size-3" aria-hidden />
          Ready with gaps
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="red">
          <XCircle className="size-3" aria-hidden />
          Failed
        </Badge>
      );
  }
}
