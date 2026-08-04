/**
 * Placeholder landing page — the real marketing/onboarding page, dashboard shell, and project
 * wizard land in Stage 2 (see ARCHITECTURE.md §11 / docs/roadmap.md). This exists only so the
 * app boots after the Stage 1 foundation commit.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">AI Video Studio</h1>
      <p className="max-w-md text-muted-foreground">
        Foundation scaffold is in place — dashboard, project wizard, and generation UI are coming in the next
        stages. See <code>ARCHITECTURE.md</code>.
      </p>
    </main>
  );
}
