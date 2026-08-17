"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Instagram, Loader2, MessageCircleReply, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

export interface InstagramAccountListItem {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  pageName: string;
  autoReplyEnabled: boolean;
  status: "active" | "disabled" | "token_expired" | "error";
}

export interface InstagramMessageListItem {
  id: string;
  incomingText: string;
  replyText?: string;
  status: "replied" | "failed" | "skipped";
  error?: string;
  createdAt: string;
}

const STATUS_BADGE: Record<InstagramAccountListItem["status"], { label: string; variant: "success" | "secondary" | "warning" | "destructive" }> = {
  active: { label: "Connected", variant: "success" },
  disabled: { label: "Disabled", variant: "secondary" },
  token_expired: { label: "Token expired — reconnect", variant: "warning" },
  error: { label: "Error", variant: "destructive" },
};

const MESSAGE_STATUS_BADGE: Record<InstagramMessageListItem["status"], { label: string; variant: "success" | "secondary" | "destructive" }> = {
  replied: { label: "Replied", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Skipped (auto-reply off)", variant: "secondary" },
};

export function InstagramManager({
  initialAccounts,
  initialMessages,
}: {
  initialAccounts: InstagramAccountListItem[];
  initialMessages: InstagramMessageListItem[];
}) {
  const router = useRouter();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function toggleAutoReply(id: string, enabled: boolean) {
    setTogglingId(id);
    await fetch(`/api/instagram/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReplyEnabled: enabled }),
    });
    setTogglingId(null);
    router.refresh();
  }

  async function disconnect(id: string) {
    setRemovingId(id);
    await fetch(`/api/instagram/${id}`, { method: "DELETE" });
    setRemovingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/api/instagram/connect">
            <Instagram className="h-4 w-4" />
            Connect Instagram account
          </Link>
        </Button>
      </div>

      {initialAccounts.length === 0 ? (
        <EmptyState
          icon={Instagram}
          title="No Instagram account connected"
          description="Connect a professional (Business/Creator) Instagram account, linked to a Facebook Page, to start auto-replying to DMs."
          action={
            <Button asChild>
              <Link href="/api/instagram/connect">Connect your first account</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {initialAccounts.map((account) => {
            const badge = STATUS_BADGE[account.status];
            return (
              <Card key={account.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <Avatar>
                    <AvatarImage src={account.profilePictureUrl} alt={account.username} />
                    <AvatarFallback>{account.username.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">@{account.username}</p>
                    <p className="truncate text-xs text-muted-foreground">via {account.pageName}</p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <Button
                    variant={account.autoReplyEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleAutoReply(account.id, !account.autoReplyEnabled)}
                    disabled={togglingId === account.id}
                  >
                    {togglingId === account.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Auto-reply {account.autoReplyEnabled ? "on" : "off"}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Disconnect" onClick={() => disconnect(account.id)} disabled={removingId === account.id}>
                    {removingId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleReply className="h-4 w-4" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {initialMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages received yet.</p>
          ) : (
            <ul className="space-y-3">
              {initialMessages.map((m) => {
                const badge = MESSAGE_STATUS_BADGE[m.status];
                return (
                  <li key={m.id} className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Them: </span>
                      {m.incomingText}
                    </p>
                    {m.replyText && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Reply: </span>
                        {m.replyText}
                      </p>
                    )}
                    {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
