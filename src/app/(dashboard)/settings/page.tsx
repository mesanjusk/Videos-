import { auth } from "@/core/auth/auth";
import { listEnabledProviders } from "@/core/ai/registry";
import { getOrCreateSettings } from "@/modules/settings/service";
import { requireUserId } from "@/core/auth/session";
import { listApiTokens } from "@/modules/api-tokens/service";
import { getExtensionPresence } from "@/core/browser/extension-presence";
import { findAccountWithFlowSession } from "@/modules/accounts/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { HelpButton } from "@/components/shared/help-button";
import { ProviderSettings } from "./provider-settings";
import { LanguageSetting } from "./language-setting";
import { ApiTokens } from "./api-tokens";

// Reading a session already forces this page to render per request, but the extension row's whole
// value is that it is current — so the intent is stated rather than inherited from an import.
export const dynamic = "force-dynamic";

function statusBadge(configured: boolean) {
  return <Badge variant={configured ? "success" : "secondary"}>{configured ? "Connected" : "Not configured"}</Badge>;
}

/** "34 seconds ago", for a check-in whose whole meaning is how recent it is. */
function sinceLabel(iso: string | undefined): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `last seen ${seconds}s ago`;
  return `last seen ${Math.round(seconds / 60)}m ago`;
}

export default async function SettingsPage() {
  const session = await auth();
  const userId = await requireUserId();
  const settings = await getOrCreateSettings(userId);
  const providers = listEnabledProviders();
  const apiTokens = await listApiTokens(userId);

  // The Google Flow image route's two halves, shown because there was no way to see either.
  //
  // When the route is shut, every failure message says the same thing — load the extension — and
  // nothing tells you which part is actually missing: the token unset on the server, the extension
  // not loaded, the wrong app URL in its side panel, claiming switched off. Each looks identical
  // from the outside, and the only feedback was an image job failing several minutes later.
  const [extension, flowAccount] = await Promise.all([
    getExtensionPresence(),
    findAccountWithFlowSession(userId).catch(() => null),
  ]);

  const systemStatus = [
    { label: "MongoDB Atlas", configured: !!process.env.MONGODB_URI },
    { label: "Cloudinary", configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) },
    { label: "Upstash Redis (queue)", configured: !!process.env.REDIS_URL },
    {
      label: "Extension token (BROWSER_EXTENSION_TOKEN)",
      configured: !!process.env.BROWSER_EXTENSION_TOKEN,
      // Without it the extension's every request is refused and it cannot say it is there at all,
      // so this row is the first thing to read when the one below says "Not configured".
      note: process.env.BROWSER_EXTENSION_TOKEN ? undefined : "The extension cannot connect until this is set",
    },
    {
      label: "Chrome extension (draws images in Flow)",
      configured: extension.connected,
      note: extension.connected
        ? [extension.workerId, sinceLabel(extension.lastSeenAt)].filter(Boolean).join(" · ")
        : "Load the extension, sign into Flow in that browser, switch claiming on",
    },
    {
      label: "Flow browser session (worker-driven video)",
      configured: flowAccount !== null,
      note: flowAccount ? undefined : "Only needed for video — images run through the extension",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <HelpButton text="Theme, default language, which AI provider each generation step uses, and the connection status of your storage, database, queue and the Chrome extension that draws images in Google Flow." />
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
          <CardDescription>
            Whether each piece of infrastructure is configured for this deployment. The extension row is live —
            it reports connected while a browser is checking in, and goes quiet within 90 seconds of one closing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {systemStatus.map((s) => (
            <div key={s.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="flex flex-col">
                <span>{s.label}</span>
                {"note" in s && s.note ? <span className="text-xs text-muted-foreground">{s.note}</span> : null}
              </span>
              {statusBadge(s.configured)}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
