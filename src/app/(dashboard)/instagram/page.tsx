import { requireUserId } from "@/core/auth/session";
import { listInstagramAccounts, listRecentInstagramMessages } from "@/modules/instagram/service";
import { HelpButton } from "@/components/shared/help-button";
import { InstagramManager, type InstagramAccountListItem, type InstagramMessageListItem } from "./instagram-manager";

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const [accounts, messages] = await Promise.all([listInstagramAccounts(userId), listRecentInstagramMessages(userId)]);
  const { connected, error } = await searchParams;

  const accountItems: InstagramAccountListItem[] = accounts.map((a) => ({
    id: a._id.toString(),
    username: a.username,
    name: a.name ?? undefined,
    profilePictureUrl: a.profilePictureUrl ?? undefined,
    pageName: a.pageName,
    autoReplyEnabled: a.autoReplyEnabled ?? false,
    status: a.status as InstagramAccountListItem["status"],
  }));

  const messageItems: InstagramMessageListItem[] = messages.map((m) => ({
    id: m._id.toString(),
    incomingText: m.incomingText,
    replyText: m.replyText ?? undefined,
    status: m.status,
    error: m.error ?? undefined,
    createdAt: new Date(m.createdAt as Date).toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Instagram auto-reply</h1>
        <HelpButton text="Auto-replies to DMs your Instagram professional account receives, using Meta's official Messaging API and Gemini to draft the response. Only replies to messages sent to you first — this app never sends unsolicited/cold DMs, which Meta's terms prohibit outright." />
      </div>
      <p className="max-w-xl text-sm text-muted-foreground">
        Connect an Instagram professional account (via its linked Facebook Page) and turn on auto-reply. Every reply
        is drafted by Gemini and sent through Meta&rsquo;s official Send API, only ever in response to a message the
        customer sent first.
      </p>

      {connected && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600">
          Instagram account connected.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Couldn&rsquo;t connect: {decodeURIComponent(error)}
        </p>
      )}

      <InstagramManager initialAccounts={accountItems} initialMessages={messageItems} />
    </div>
  );
}
