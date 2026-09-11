"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { z } from "zod";
import type { KitInput } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api, type CreateKitResponse } from "@/lib/api";

const MAX_JD = 50_000;

/**
 * Deliberately permissive: hosts without a dot (localhost, an internal name) and
 * explicit ports are all legitimate here, and the server guards what is actually
 * fetched. The only thing rejected is text that is not a URL at all.
 */
function looksLikeUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.length > 0 && !url.hostname.includes(" ");
  } catch {
    return false;
  }
}

const roleSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(40, "Paste the whole job description — a line or two is not enough to work from.")
    .max(MAX_JD, `That is longer than ${MAX_JD.toLocaleString()} characters.`),
  companyUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(looksLikeUrl, "That does not look like a web address."),
  days: z
    .number({ invalid_type_error: "Enter a number of days." })
    .int("Whole days only.")
    .min(1, "At least one day.")
    .max(60, "Sixty days is the longest plan this builds."),
});

const formSchema = z.object({ roles: z.array(roleSchema).min(1) });
type FormValues = z.infer<typeof formSchema>;

const emptyRole = { jd: "", companyUrl: "", days: 7 };

export function CreateKitForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [duplicate, setDuplicate] = useState<CreateKitResponse | null>(null);
  const [pendingInput, setPendingInput] = useState<KitInput | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { roles: [emptyRole] },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "roles" });

  const create = useMutation({
    mutationFn: async (roles: KitInput[]) => {
      if (roles.length === 1) {
        const result = await api.createKit(roles[0]!);
        return { results: [result], batched: false };
      }
      const result = await api.createKitBatch(roles);
      return { results: result.kits, batched: true };
    },
    onSuccess: ({ results, batched }) => {
      const first = results[0]!;
      // A single role that already exists asks before spending another run.
      if (!batched && first.existing) {
        setDuplicate(first);
        return;
      }
      if (batched) {
        toast(`${results.length} kits queued. They generate one after another.`, "success");
        router.push("/kits");
      } else {
        router.push(`/kits/${first.kit.id}`);
      }
    },
    onError: (error) => {
      toast(
        error instanceof ApiError ? error.message : "Could not start generation. Try again.",
        "error",
      );
    },
  });

  const regenerate = useMutation({
    mutationFn: (input: KitInput) => api.createKit({ ...input, force: true }),
    onSuccess: (result) => {
      setDuplicate(null);
      router.push(`/kits/${result.kit.id}`);
    },
    onError: () => toast("Could not start a fresh run.", "error"),
  });

  const onSubmit = form.handleSubmit((values) => {
    const roles: KitInput[] = values.roles.map((role) => ({
      jd: role.jd.trim(),
      companyUrl: role.companyUrl.trim(),
      days: role.days,
    }));
    setPendingInput(roles[0] ?? null);
    create.mutate(roles);
  });

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {fields.map((field, index) => {
          const errors = form.formState.errors.roles?.[index];
          const jdValue = form.watch(`roles.${index}.jd`) ?? "";

          return (
            <Card key={field.id}>
              <CardBody className="space-y-4">
                {fields.length > 1 ? (
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-zinc-900">Role {index + 1}</h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      aria-label={`Remove role ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}

                <Textarea
                  label="Job description"
                  placeholder="Paste the whole posting, including the requirements section."
                  hint={`${jdValue.length.toLocaleString()} characters. The more of the posting you paste, the fewer guesses this has to make.`}
                  error={errors?.jd?.message}
                  className="min-h-56 font-mono text-xs leading-relaxed"
                  {...form.register(`roles.${index}.jd`)}
                />

                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Input
                    label="Company website"
                    placeholder="acme.com"
                    hint="Optional. Used to read what they do and how they interview."
                    error={errors?.companyUrl?.message}
                    {...form.register(`roles.${index}.companyUrl`)}
                  />
                  <DaysField
                    value={form.watch(`roles.${index}.days`)}
                    error={errors?.days?.message}
                    onChange={(next) =>
                      form.setValue(`roles.${index}.days`, next, { shouldValidate: true })
                    }
                  />
                </div>
              </CardBody>
            </Card>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={create.isPending}>
            <Sparkles className="size-4" aria-hidden />
            {fields.length > 1 ? `Generate ${fields.length} kits` : "Generate kit"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => append(emptyRole)}
            disabled={fields.length >= 10}
          >
            <Plus className="size-4" aria-hidden />
            Add another role
          </Button>
          {fields.length >= 10 ? (
            <p className="text-xs text-muted">Ten roles is the most you can queue at once.</p>
          ) : null}
        </div>

        <p className="text-xs text-muted">
          Generation takes about a minute per role. You can leave this page; progress is saved.
        </p>
      </form>

      <Dialog
        open={duplicate !== null}
        onClose={() => setDuplicate(null)}
        title="You already have a kit for this posting"
        description="Nothing about the posting, the company or the day count has changed since you last generated it."
        footer={
          <>
            <Button
              variant="secondary"
              loading={regenerate.isPending}
              onClick={() => pendingInput && regenerate.mutate(pendingInput)}
            >
              Generate again
            </Button>
            <Button onClick={() => duplicate && router.push(`/kits/${duplicate.kit.id}`)}>
              Open the existing kit
            </Button>
          </>
        }
      />
    </>
  );
}

function DaysField({
  value,
  error,
  onChange,
}: {
  value: number;
  error?: string;
  onChange: (next: number) => void;
}) {
  const clamp = (next: number) => Math.min(60, Math.max(1, next));

  return (
    <div className="space-y-1.5">
      <label htmlFor="days-input" className="block text-sm font-medium text-zinc-800">
        Days until the interview
      </label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-10 w-10 p-0"
          onClick={() => onChange(clamp((value || 1) - 1))}
          aria-label="One day fewer"
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <input
          id="days-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          aria-invalid={error ? true : undefined}
          className="h-10 w-16 rounded-lg border border-line bg-white text-center text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-10 w-10 p-0"
          onClick={() => onChange(clamp((value || 0) + 1))}
          aria-label="One day more"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
