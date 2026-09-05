"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  Clapperboard,
  FolderKanban,
  Instagram,
  LibraryBig,
  ListChecks,
  Mic2,
  Palette,
  Users,
  UserRound,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Three things, and a drawer for the rest.
 *
 * The sidebar used to list sixteen destinations, flat and equally weighted: Dashboard, Create
 * Video, Production Profiles, Pipeline Monitor, Projects, Characters, Backgrounds, Style Packs,
 * Voice Packs, Queue, Browser Automation, Workflows, Instagram, Google Accounts, Prompt Library,
 * Settings. Making a video needs exactly two of them, and connecting an account needs a third.
 * The other thirteen are for someone tuning a pipeline that is already running — a real job, but
 * not the one a person opening this app for the first time is doing.
 *
 * Nothing was deleted. A flat list of sixteen and a list of three with thirteen behind a disclosure
 * reach the same pages; only one of them tells you where to start.
 */
const PRIMARY = [
  { href: "/create", label: "Make", icon: Sparkles },
  { href: "/projects", label: "My videos", icon: FolderKanban },
  { href: "/accounts", label: "Setup", icon: UserRound },
];

const ADVANCED = [
  { href: "/production", label: "Pipeline monitor", icon: Activity },
  { href: "/production-profiles", label: "Production profiles", icon: Clapperboard },
  { href: "/queue", label: "Queue", icon: ListChecks },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/library", label: "Backgrounds", icon: LibraryBig },
  { href: "/style-packs", label: "Style packs", icon: Palette },
  { href: "/voice-packs", label: "Voice packs", icon: Mic2 },
  { href: "/browser-automation", label: "Browser automation", icon: Bot },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/prompts", label: "Prompt library", icon: SlidersHorizontal },
  { href: "/instagram", label: "Instagram", icon: Instagram },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({
  item,
  onNavigate,
  small,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
  onNavigate?: () => void;
  small?: boolean;
}) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 transition-colors",
        small ? "py-1.5 text-sm" : "py-2.5 text-[15px] font-medium",
        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className={small ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} />
      {item.label}
    </Link>
  );
}

/** Nav items + brand header, shared by the always-visible desktop <aside> and the mobile drawer (Sheet). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Open itself when you are already somewhere inside it, so an advanced page never looks like it
  // has no navigation.
  const [open, setOpen] = useState(() => ADVANCED.some((item) => pathname.startsWith(item.href)));

  return (
    <>
      <Link href="/create" onClick={onNavigate} className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Clapperboard className="h-4 w-4" />
        </div>
        <span className="font-semibold tracking-tight">Studio</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}

        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Advanced
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="flex flex-col gap-0.5">
              {ADVANCED.map((item) => (
                <NavLink key={item.href} item={item} onNavigate={onNavigate} small />
              ))}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card/40 lg:flex">
      <SidebarNav />
    </aside>
  );
}
