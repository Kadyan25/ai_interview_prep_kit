import { BatchUpload } from "@/components/kits/BatchUpload";
import { CreateKitForm } from "@/components/kits/CreateKitForm";

export const metadata = { title: "New kit · Interview Prep Kit" };

export default function NewKitPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">New kit</h1>
        <p className="text-sm text-muted">
          Paste the posting and give the company URL. You get a brief, a question bank tied to their
          requirements, flashcards and a day-by-day plan.
        </p>
      </div>

      <CreateKitForm />
      <BatchUpload />
    </div>
  );
}
