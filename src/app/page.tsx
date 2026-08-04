import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard, Sparkles, Wand2, Film } from "lucide-react";
import { auth } from "@/core/auth/auth";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Clapperboard className="h-7 w-7" />
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn one idea into a finished cartoon video
        </h1>
        <p className="max-w-xl text-muted-foreground">
          No prompts. No AI tools to learn. Just an idea — we guide you through story, characters, scenes,
          voice, and editing, end to end.
        </p>
        <Button asChild size="lg">
          <Link href="/login">Get started free</Link>
        </Button>
      </div>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-5">
          <Wand2 className="h-5 w-5 text-primary" />
          <p className="text-sm font-medium">Guided, step by step</p>
          <p className="text-xs text-muted-foreground">Every screen tells you exactly what to do next.</p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-5">
          <Sparkles className="h-5 w-5 text-primary" />
          <p className="text-sm font-medium">Consistent characters</p>
          <p className="text-xs text-muted-foreground">Create once, reuse across every scene automatically.</p>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-5">
          <Film className="h-5 w-5 text-primary" />
          <p className="text-sm font-medium">Export-ready video</p>
          <p className="text-xs text-muted-foreground">Music, captions, and transitions handled for you.</p>
        </div>
      </div>
    </main>
  );
}
