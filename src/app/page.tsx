import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard, Sparkles, Wand2, Film } from "lucide-react";
import { auth } from "@/core/auth/auth";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/create");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 p-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Clapperboard className="h-7 w-7" />
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Say it. Watch it. Download it.
        </h1>
        <p className="max-w-md text-muted-foreground">One sentence becomes a finished video.</p>
        <Button asChild size="lg">
          <Link href="/login">Get started free</Link>
        </Button>
      </div>

      <div className="flex max-w-lg flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Wand2 className="h-4 w-4 text-primary" /> Story written for you
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" /> Characters stay the same
        </span>
        <span className="flex items-center gap-1.5">
          <Film className="h-4 w-4 text-primary" /> Ready to post
        </span>
      </div>
    </main>
  );
}
