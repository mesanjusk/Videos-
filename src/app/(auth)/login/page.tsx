import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { auth } from "@/core/auth/auth";
import { LoginButton } from "./login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/create");
  const { callbackUrl } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Clapperboard className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Welcome to AI Video Studio</h1>
          <p className="text-sm text-muted-foreground">
            Turn an idea into a finished cartoon video — no prompts, no AI experience needed.
          </p>
        </div>
        <LoginButton callbackUrl={callbackUrl ?? "/create"} />
      </div>
    </main>
  );
}
