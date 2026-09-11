import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Sign in · Interview Prep Kit" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
