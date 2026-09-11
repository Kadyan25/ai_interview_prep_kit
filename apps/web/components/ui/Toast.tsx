"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };

type ToastContextValue = {
  toast: (message: string, tone?: Tone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const icons: Record<Tone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />,
  error: <XCircle className="size-4 text-red-600" aria-hidden />,
  info: <Info className="size-4 text-brand-600" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, tone }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:right-4 sm:top-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border bg-white px-3 py-2 shadow-lg",
              t.tone === "error" ? "border-red-200" : "border-line",
            )}
          >
            <span className="mt-0.5">{icons[t.tone]}</span>
            <p className="flex-1 text-sm text-zinc-800">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-700"
              aria-label="Dismiss notification"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
