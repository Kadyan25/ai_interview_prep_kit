import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <AppNav />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:pb-10">
        {children}
      </main>
    </div>
  );
}
