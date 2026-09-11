import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Create account · Interview Prep Kit" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
