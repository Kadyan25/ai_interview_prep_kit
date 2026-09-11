"use client";

import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50 aria-[invalid=true]:border-red-400";

type LabelProps = { label: string; error?: string; hint?: string };

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & LabelProps
>(function Input({ label, error, hint, className, id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(control, className)}
        {...rest}
      />
      {hint && !error ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & LabelProps
>(function Textarea({ label, error, hint, className, id, ...rest }, ref) {
  const generated = useId();
  const textareaId = id ?? generated;
  const describedBy = error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={textareaId} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      <textarea
        ref={ref}
        id={textareaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(control, "min-h-32 resize-y", className)}
        {...rest}
      />
      {hint && !error ? (
        <p id={`${textareaId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${textareaId}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
});
