import { Check } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { listGoogleAccounts } from "@/modules/accounts/service";
import { cn } from "@/lib/utils";
import { AccountsManager, type AccountListItem } from "./accounts-manager";

export const dynamic = "force-dynamic";

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

  // The only two facts that decide whether "make me a video" can finish on its own. Both are
  // derived from the accounts that exist, not from a stored setup flag — a session someone
  // disconnected has to show as undone the moment it is.
  const hasAccount = items.length > 0;
  const hasFlow = items.some((a) => a.flowSessionConnected);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">Two things, once.</p>
      </div>

      {/* Which of the two steps is still outstanding is the entire question this page answers, and
          it used to be answerable only by reading a badge on each account card. */}
      <ol className="space-y-2">
        <Step done={hasAccount} n={1}>
          Add a Google account and its Gemini key — this writes the story, draws the pictures and
          speaks the words.
        </Step>
        <Step done={hasFlow} n={2}>
          Connect that account&rsquo;s Google Flow session — this is what makes the video itself, and
          without it every video stops and waits for you.
        </Step>
      </ol>

      <AccountsManager initialAccounts={items} />
    </div>
  );
}

function Step({ done, n, children }: { done: boolean; n: number; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border p-4", done ? "border-border/60 bg-muted/30" : "border-border")}>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <span className={cn("text-sm", done && "text-muted-foreground")}>{children}</span>
    </li>
  );
}
