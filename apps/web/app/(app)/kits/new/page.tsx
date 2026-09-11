import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";

export const metadata = { title: "New kit · Interview Prep Kit" };

export default function NewKitPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">New kit</h1>
      <EmptyState
        title="Kit generation is not wired up yet"
        description="The create form lands with the generation pipeline."
        action={<LinkButton href="/kits" variant="secondary">Back to my kits</LinkButton>}
      />
    </div>
  );
}
