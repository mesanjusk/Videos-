import { auth } from "@/core/auth/auth";
import { listEnabledProviders } from "@/core/ai/registry";
import { getOrCreateSettings } from "@/modules/settings/service";
import { requireUserId } from "@/core/auth/session";
import { listApiTokens } from "@/modules/api-tokens/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { HelpButton } from "@/components/shared/help-button";
import { ProviderSettings } from "./provider-settings";
import { LanguageSetting } from "./language-setting";
import { ApiTokens } from "./api-tokens";

function statusBadge(configured: boolean) {
  return <Badge variant={configured ? "success" : "secondary"}>{configured ? "Connected" : "Not configured"}</Badge>;
}

export default async function SettingsPage() {
  const session = await auth();
  const userId = await requireUserId();
  const settings = await getOrCreateSettings(userId);
  const providers = listEnabledProviders();
  const apiTokens = await listApiTokens(userId);

  const systemStatus = [
    { label: "MongoDB Atlas", configured: !!process.env.MONGODB_URI },
    { label: "Cloudinary", configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) },
    { label: "Upstash Redis (queue)", configured: !!process.env.REDIS_URL },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <HelpButton text="Theme, default language, which AI provider each generation step uses, and the connection status of your storage/database/queue." />
      </div>

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
          <CardTitle>Language</CardTitle>
          <CardDescription>Default language for new projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageSetting defaultLanguage={settings.defaultLanguage ?? "en"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI providers</CardTitle>
          <CardDescription>
            Every generation step runs through a provider-agnostic interface (ARCHITECTURE.md §2) — pick which
            provider handles each step. Only Google services are enabled today; more can be added without
            touching the rest of the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderSettings
            providers={providers}
            overrides={{
              story: settings.providerOverrides?.story ?? undefined,
              image: settings.providerOverrides?.image ?? undefined,
              video: settings.providerOverrides?.video ?? undefined,
              voice: settings.providerOverrides?.voice ?? undefined,
              lipsync: settings.providerOverrides?.lipsync ?? undefined,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            For non-browser clients — like the Claude Code plugin (see <code>plugin/</code> in the repo) — that
            drive this app&apos;s API without a browser session. Mint a token here, then set it as the plugin&apos;s{" "}
            <code>CARTOON_API_TOKEN</code> environment variable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiTokens
            initialTokens={apiTokens.map((t) => ({
              id: t._id.toString(),
              name: t.name,
              tokenPrefix: t.tokenPrefix,
              lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : undefined,
              createdAt: new Date(t.createdAt as Date).toISOString(),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Whether each piece of infrastructure is configured for this deployment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {systemStatus.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span>{s.label}</span>
              {statusBadge(s.configured)}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
