import type { ReactNode } from "react";
import { NotebookPen } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <NotebookPen className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Interview Prep Kit</p>
          <p className="text-xs text-muted">A plan for the role you are actually applying to.</p>
        </div>
      </div>
      {children}
    </main>
  );
}
