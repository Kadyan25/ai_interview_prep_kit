"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Click or press Enter to edit, Escape to abandon, blur or Enter to keep.
 * Editing in place beats a modal here: the user is comparing the question to the
 * requirement next to it, and a dialog would hide exactly that.
 */
export function InlineEdit({
  value,
  onSave,
  label,
  multiline = false,
  className,
  placeholder,
}: {
  value: string;
  onSave: (next: string) => void;
  label: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const element = inputRef.current;
    element?.focus();
    if (element && "setSelectionRange" in element) {
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [editing]);

  const commit = () => {
    const next = text.trim();
    setEditing(false);
    if (next.length === 0) {
      setText(value);
      return;
    }
    if (next !== value) onSave(next);
  };

  const cancel = () => {
    setText(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
        className={cn(
          "group/edit -mx-1 w-full rounded px-1 text-left hover:bg-brand-50/60",
          className,
        )}
      >
        <span className={cn(value ? "" : "text-zinc-400")}>{value || placeholder || "Empty"}</span>
        <Pencil
          className="ml-1.5 inline size-3 shrink-0 align-baseline text-zinc-300 opacity-0 transition-opacity group-hover/edit:opacity-100"
          aria-hidden
        />
      </button>
    );
  }

  const shared = {
    ref: inputRef as never,
    value: text,
    "aria-label": label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setText(e.target.value),
    onBlur: commit,
    className: cn(
      "w-full rounded border border-brand-300 bg-white px-1.5 py-1 outline-none",
      className,
    ),
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={Math.min(10, Math.max(2, text.split("\n").length + 1))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          // Enter adds a line; the field saves on blur or with the shortcut.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <input
      {...shared}
      type="text"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
