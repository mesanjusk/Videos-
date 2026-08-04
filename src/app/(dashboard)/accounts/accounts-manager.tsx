"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Loader2, MoreVertical, Plus, ShieldCheck, UserRound } from "lucide-react";
import { addGoogleAccountSchema, type AddGoogleAccountFormInput } from "@/modules/accounts/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/empty-state";

export interface AccountListItem {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  status: "active" | "disabled" | "quota_exceeded" | "error";
  isDefault: boolean;
  quotaUsed: number;
  quotaLimit: number;
  lastUsedAt: string | null;
}

const STATUS_BADGE: Record<AccountListItem["status"], { label: string; variant: "success" | "secondary" | "warning" | "destructive" }> = {
  active: { label: "Active", variant: "success" },
  disabled: { label: "Disabled", variant: "secondary" },
  quota_exceeded: { label: "Quota exceeded", variant: "warning" },
  error: { label: "Error", variant: "destructive" },
};

export function AccountsManager({ initialAccounts }: { initialAccounts: AccountListItem[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function performAction(id: string, action: "enable" | "disable" | "set-default") {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    router.refresh();
  }

  async function removeAccount(id: string) {
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Google account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <AddAccountForm
              onSuccess={() => {
                setDialogOpen(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialAccounts.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No Google accounts connected"
          description="Add at least one to start generating. Each free Google account gives you its own Gemini free-tier quota."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first account
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
                    <AvatarImage src={account.avatarUrl ?? undefined} alt={account.displayName} />
                    <AvatarFallback>{account.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{account.displayName}</p>
                      {account.isDefault && (
                        <Badge variant="outline">
                          <ShieldCheck className="h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Account actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!account.isDefault && (
                        <DropdownMenuItem onSelect={() => performAction(account.id, "set-default")}>
                          Set as default
                        </DropdownMenuItem>
                      )}
                      {account.status !== "active" ? (
                        <DropdownMenuItem onSelect={() => performAction(account.id, "enable")}>
                          {account.status === "quota_exceeded" ? "Reactivate now" : "Enable"}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => performAction(account.id, "disable")}>Disable</DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onSelect={() => removeAccount(account.id)}>
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddAccountForm({ onSuccess }: { onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddGoogleAccountFormInput>({ resolver: zodResolver(addGoogleAccountSchema) });

  async function onSubmit(values: AddGoogleAccountFormInput) {
    setServerError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Failed to add account");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>Add a Google account</DialogTitle>
        <DialogDescription>
          Sign in to this Google account in another tab, generate a free Gemini API key, then paste it below.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Get a free Gemini API key
          <ExternalLink className="h-3 w-3" />
        </a>
        <div className="space-y-2">
          <Label htmlFor="displayName">Account name</Label>
          <Input id="displayName" placeholder="e.g. Personal Gmail" {...register("displayName")} />
          {errors.displayName && <p className="text-xs text-destructive">{errors.displayName.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Google account email</Label>
          <Input id="email" type="email" placeholder="you@gmail.com" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiKey">Gemini API key</Label>
          <Input id="apiKey" type="password" placeholder="AIza..." {...register("apiKey")} />
          {errors.apiKey && <p className="text-xs text-destructive">{errors.apiKey.message}</p>}
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Connect account
        </Button>
      </DialogFooter>
    </form>
  );
}
