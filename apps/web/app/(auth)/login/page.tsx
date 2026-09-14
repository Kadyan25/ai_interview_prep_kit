import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Sign in · Interview Prep Kit" };

/** Only same-site paths: an absolute or protocol-relative `next` would be an open redirect. */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/kits";
  }
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <AuthForm mode="login" next={safeNext(params.next)} expired={params.expired === "1"} />;
}
