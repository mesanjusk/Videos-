"use client";

import { Clapperboard, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { WorkflowStep } from "@/lib/workflow-steps";

interface CenterHubProps {
  activeStep: WorkflowStep;
  completionPercent: number;
  quickActionHref: string;
  quickActionLabel: string;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CenterHub({ activeStep, completionPercent, quickActionHref, quickActionLabel }: CenterHubProps) {
  const dashOffset = CIRCUMFERENCE - (completionPercent / 100) * CIRCUMFERENCE;

  return (
    <div
      className="absolute left-1/2 top-1/2 flex h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full glass-panel text-center shadow-[0_0_60px_rgba(124,58,237,0.35)]"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-none absolute inset-[-6%] rounded-full border border-dashed border-white/10 motion-safe:animate-spin-slow"
        aria-hidden
      />
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <motion.circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="url(#hub-progress-gradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: CIRCUMFERENCE }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="hub-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>

      <div className="z-10 flex flex-col items-center gap-1.5 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/40">
          <Clapperboard className="h-4.5 w-4.5 text-white" />
        </div>
        <p className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{completionPercent}%</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-white/50 sm:text-xs">
          {activeStep.shortLabel}
        </p>
        <span className="mt-0.5 flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          <Sparkles className="h-2.5 w-2.5 motion-safe:animate-pulse" aria-hidden />
          AI Ready
        </span>
        <Button asChild size="sm" className="mt-1 h-7 rounded-full px-3 text-[11px]">
          <Link href={quickActionHref}>{quickActionLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
