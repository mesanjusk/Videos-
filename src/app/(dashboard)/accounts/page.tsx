import { requireUserId } from "@/core/auth/session";
import { listGoogleAccounts } from "@/modules/accounts/service";
import { HelpButton } from "@/components/shared/help-button";
import { AccountsManager, type AccountListItem } from "./accounts-manager";

export default async function AccountsPage() {
  const userId = await requireUserId();
  const accounts = await listGoogleAccounts(userId);

  const items: AccountListItem[] = accounts.map((a) => ({
    id: a._id.toString(),
    email: a.email,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status,
    isDefault: a.isDefault,
    quotaUsed: a.quota?.used ?? 0,
    quotaLimit: a.quota?.dailyLimit ?? 0,
    lastUsedAt: a.lastUsedAt ? new Date(a.lastUsedAt).toISOString() : null,
    flowSessionConnected: !!a.flowSessionConnectedAt,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Google accounts</h1>
        <HelpButton text="Connect multiple free Google/Gemini accounts to spread generation across their free-tier quotas. We automatically pick an available account for every job and skip ones that are out of quota." />
      </div>
      <p className="max-w-xl text-sm text-muted-foreground">
        Every story, image, and voice generation uses one of these accounts. Add more to avoid hitting free-tier
        limits — we&rsquo;ll rotate between them automatically.
      </p>
      <AccountsManager initialAccounts={items} />
    </div>
  );
}
