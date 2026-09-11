import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";

export const metadata = { title: "Kit · Interview Prep Kit" };

export default function KitPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">Kit</h1>
      <EmptyState
        title="The kit view is not built yet"
        description="Brief, questions, flashcards and schedule land with the generation pipeline."
        action={
          <LinkButton href="/kits" variant="secondary">
            Back to my kits
          </LinkButton>
        }
      />
    </div>
  );
}
