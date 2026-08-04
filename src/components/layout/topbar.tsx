"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";

interface TopbarProps {
  user: { name?: string | null; email?: string | null; image?: string | null };
}

export function Topbar({ user }: TopbarProps) {
  const initials = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
      <div className="lg:hidden font-semibold">AI Video Studio</div>
      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm">
          <Link href="/projects/new">
            <Plus className="h-4 w-4" />
            New project
          </Link>
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
              <Avatar>
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? "Account"} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/" })}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
