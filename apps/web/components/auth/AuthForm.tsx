"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "At least 8 characters."),
});

type Values = z.infer<typeof schema>;

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register: field,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (mode === "register") {
        await api.register(values.email, values.password);
      } else {
        await api.login(values.email, values.password);
      }
      router.push("/kits");
      router.refresh();
    } catch (e) {
      setFormError(
        e instanceof ApiError ? e.message : "Something went wrong. Try again in a moment.",
      );
    }
  });

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "login"
              ? "Pick up where you left off."
              : "Your kits and practice history stay on your account."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...field("email")}
          />
          <Input
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            hint={mode === "register" ? "At least 8 characters." : undefined}
            error={errors.password?.message}
            {...field("password")}
          />

          {formError ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          <Button type="submit" loading={isSubmitting} className="w-full">
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="text-sm text-muted">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <Link href="/register" className="font-medium text-brand-600 hover:underline">
                Create one
              </Link>
            </>
          ) : (
            <>
              Already registered?{" "}
              <Link href="/login" className="font-medium text-brand-600 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </CardBody>
    </Card>
  );
}
