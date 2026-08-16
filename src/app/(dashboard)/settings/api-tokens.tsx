"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ApiTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt?: string;
  createdAt: string;
}

/**
 * Personal API tokens — what the Claude Code plugin's MCP server (or any other non-browser client)
 * authenticates with, one `Authorization: Bearer <token>` header at a time (see
 * core/auth/session.ts#requireUserId). The raw token is only ever shown here, once, right after
 * creation — see modules/api-tokens/service.ts for why.
 */
export function ApiTokens({ initialTokens }: { initialTokens: ApiTokenSummary[] }) {
  const router = useRouter();
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createToken() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) return;
      const { token, record } = await res.json();
      setTokens((prev) => [{ ...record, createdAt: record.createdAt ?? new Date().toISOString() }, ...prev]);
      setMintedToken(token);
      setName("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await fetch(`/api/api-tokens/${id}`, { method: "DELETE" });
      setTokens((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  async function copyMintedToken() {
    if (!mintedToken) return;
    await navigator.clipboard.writeText(mintedToken);
    setCopied(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Token name, e.g. Claude Code plugin"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createToken()}
        />
        <Button onClick={createToken} disabled={creating || !name.trim()}>
          {creating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Create
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API tokens yet.</p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{t.tokenPrefix}…</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => revoke(t.id)} disabled={revoking === t.id}>
                {revoking === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!mintedToken}
        onOpenChange={(open) => {
          if (!open) {
            setMintedToken(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your token now</DialogTitle>
            <DialogDescription>
              This is the only time it&apos;s shown. Paste it into the Claude Code plugin&apos;s{" "}
              <code>CARTOON_API_TOKEN</code> environment variable.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={mintedToken ?? ""} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyMintedToken}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {copied && <p className="text-xs text-muted-foreground">Copied.</p>}
          <DialogFooter>
            <Button onClick={() => setMintedToken(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
