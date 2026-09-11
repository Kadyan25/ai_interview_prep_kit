"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, FileJson, Upload } from "lucide-react";
import { z } from "zod";
import type { KitInput } from "@prep/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";

/** The same shape the batch runner reads, minus the id the grader supplies. */
const rowSchema = z.object({
  jd: z.string().trim().min(1, "jd is empty"),
  company_url: z.string().trim().default(""),
  days: z.number().int().min(1).max(60),
});

const fileSchema = z.union([
  z.array(rowSchema),
  z.object({ cases: z.array(rowSchema) }).transform((v) => v.cases),
  z.object({ kits: z.array(rowSchema) }).transform((v) => v.kits),
]);

type Row = { input: KitInput; error?: string };

export function BatchUpload() {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setFileError(null);
    setRows(null);
    setFileName(file.name);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setFileError("That file is not valid JSON.");
      return;
    }

    const result = fileSchema.safeParse(parsed);
    if (!result.success) {
      setFileError(
        "Expected a JSON array of objects with jd, company_url and days. " +
          result.error.issues
            .slice(0, 2)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
      );
      return;
    }

    if (result.data.length === 0) {
      setFileError("That file has no roles in it.");
      return;
    }

    setRows(
      result.data.slice(0, 10).map((row) => ({
        input: { jd: row.jd, companyUrl: row.company_url, days: row.days },
        ...(row.jd.trim().length < 40
          ? { error: "Very short posting — the kit will be thin and will say so." }
          : {}),
      })),
    );

    if (result.data.length > 10) {
      setFileError(`That file has ${result.data.length} roles; only the first ten are queued.`);
    }
  };

  const queue = useMutation({
    mutationFn: (inputs: KitInput[]) => api.createKitBatch(inputs),
    onSuccess: (result) => {
      toast(`${result.kits.length} kits queued. They generate one after another.`, "success");
      router.push("/kits");
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : "Could not queue those kits.", "error"),
  });

  return (
    <Card>
      <CardHeader
        title="Upload several at once"
        description="A JSON file of roles, the same shape the batch runner takes."
      />
      <CardBody className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            Choose a JSON file
          </Button>
          {fileName ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <FileJson className="size-4" aria-hidden />
              {fileName}
            </span>
          ) : null}
        </div>

        <details className="text-xs text-muted">
          <summary className="cursor-pointer">What the file should look like</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-50 p-3 text-[11px] leading-relaxed">
{`[
  { "jd": "Senior Backend Engineer…", "company_url": "acme.com", "days": 5 },
  { "jd": "Frontend Engineer…",       "company_url": "",         "days": 10 }
]`}
          </pre>
        </details>

        {fileError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {fileError}
          </p>
        ) : null}

        {rows ? (
          <div className="space-y-2">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Roles found in the uploaded file</caption>
              <thead>
                <tr className="text-xs text-muted">
                  <th scope="col" className="pb-1 font-medium">Posting</th>
                  <th scope="col" className="pb-1 font-medium">Company</th>
                  <th scope="col" className="pb-1 text-right font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="line-clamp-2 text-zinc-800">
                        {row.input.jd.slice(0, 120)}
                      </span>
                      {row.error ? (
                        <span className="mt-0.5 block text-xs text-amber-700">{row.error}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-muted">{row.input.companyUrl || "—"}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{row.input.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Button
              type="button"
              loading={queue.isPending}
              onClick={() => queue.mutate(rows.map((r) => r.input))}
            >
              Queue {rows.length} {rows.length === 1 ? "kit" : "kits"}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
