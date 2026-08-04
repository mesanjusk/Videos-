import { auth } from "@/core/auth/auth";
import { listEnabledProviders } from "@/core/ai/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * Minimal settings page for Stage 2 — theme + a read-only view of the provider registry so it's
 * clear the abstraction (ARCHITECTURE.md §2) is live. Editable provider overrides, prompt template
 * management, and notification preferences land in Stage 6.
 */
export default async function SettingsPage() {
  const session = await auth();
  const providers = listEnabledProviders();
  const byCapability = {
    story: providers.filter((p) => p.capability === "story"),
    image: providers.filter((p) => p.capability === "image"),
    video: providers.filter((p) => p.capability === "video"),
    voice: providers.filter((p) => p.capability === "voice"),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how the studio looks.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Theme</span>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Signed in as {session?.user?.name} ({session?.user?.email})
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI providers</CardTitle>
          <CardDescription>
            Every generation step runs through a provider-agnostic interface — this list is read-only for now;
            per-project overrides land in a later update.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(byCapability).map(([capability, list]) => (
            <div key={capability} className="flex items-center justify-between">
              <span className="text-sm capitalize">{capability}</span>
              <div className="flex gap-2">
                {list.map((p) => (
                  <Badge key={p.id} variant={p.enabled ? "success" : "secondary"}>
                    {p.label}
                    {!p.enabled && " (soon)"}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
