"use client";

import Link from "next/link";
import { CheckCircle2, FileText, FolderOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkflowStep, WorkflowStepStatus } from "@/lib/workflow-steps";

const STATUS_STYLES: Record<WorkflowStepStatus, string> = {
  completed: "bg-emerald-400/15 text-emerald-300",
  in_progress: "bg-white/15 text-white",
  ready: "bg-white/10 text-white/70",
  locked: "bg-black/25 text-white/50",
};

const STATUS_LABELS: Record<WorkflowStepStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  ready: "Ready to start",
  locked: "Locked",
};

const CTA_LABELS: Record<WorkflowStepStatus, string> = {
  completed: "Review this step",
  in_progress: "Continue this step",
  ready: "Start this step",
  locked: "View requirements",
};

interface StepDetailDialogProps {
  step: WorkflowStep | null;
  status: WorkflowStepStatus;
  href: string;
  onOpenChange: (open: boolean) => void;
}

export function StepDetailDialog({ step, status, href, onOpenChange }: StepDetailDialogProps) {
  return (
    <Dialog open={step !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-slate-950/95 text-white backdrop-blur-2xl sm:max-w-lg">
        {step && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${step.gradient.from}, ${step.gradient.to})` }}
                >
                  <step.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-white/50">
                    Step {step.order + 1} of 8
                  </p>
                  <DialogTitle className="text-white">{step.title}</DialogTitle>
                </div>
                <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
                  {STATUS_LABELS[status]}
                </span>
              </div>
              <DialogDescription className="pt-2 text-white/70">{step.description}</DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
                  Checklist
                </h3>
                <ul className="space-y-1.5">
                  {step.checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-white/70">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-violet-400" aria-hidden />
                  Prompts
                </h3>
                <ul className="space-y-1.5">
                  {step.prompts.map((item) => (
                    <li key={item} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                  <FolderOpen className="h-4 w-4 text-amber-400" aria-hidden />
                  Resources
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {step.resources.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60"
                    >
                      <FileText className="h-3 w-3" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <DialogFooter>
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href={href}>{CTA_LABELS[status]}</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
