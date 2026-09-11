"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces the stack in the browser console without shipping it to the page.
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      title="Something broke on this page"
      description="The rest of the app still works. Reloading this view usually clears it."
      action={
        <div className="flex gap-2">
          <Button onClick={reset}>Reload this view</Button>
          <LinkButton href="/kits" variant="secondary">
            Back to my kits
          </LinkButton>
        </div>
      }
    />
  );
}
