"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORKFLOW_STEPS,
  computeStepStatuses,
  stepHref,
  type WorkflowProgressCounts,
  type WorkflowStep,
  type WorkflowStepStatus,
} from "@/lib/workflow-steps";
import { CenterHub } from "./center-hub";
import { StepDetailDialog } from "./step-detail-dialog";

const CX = 200;
const CY = 200;
const OUTER_R = 188;
const INNER_R = 84;
const PAD_ANGLE = 0.06;

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function wedgePath(startAngle: number, endAngle: number) {
  const outerStart = polarToCartesian(CX, CY, OUTER_R, startAngle);
  const outerEnd = polarToCartesian(CX, CY, OUTER_R, endAngle);
  const innerEnd = polarToCartesian(CX, CY, INNER_R, endAngle);
  const innerStart = polarToCartesian(CX, CY, INNER_R, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

interface SliceGeometry {
  step: WorkflowStep;
  path: string;
  labelX: number;
  labelY: number;
}

const STATUS_TEXT: Record<WorkflowStepStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  ready: "Ready to start",
  locked: "Locked",
};

interface WorkflowWheelProps {
  projectId: string;
  progress: WorkflowProgressCounts;
  completionPercent: number;
  quickActionHref: string;
  quickActionLabel: string;
}

export function WorkflowWheel({ projectId, progress, completionPercent, quickActionHref, quickActionLabel }: WorkflowWheelProps) {
  const numSteps = WORKFLOW_STEPS.length;
  const angleStep = (2 * Math.PI) / numSteps;

  const slices = useMemo<SliceGeometry[]>(() => {
    return WORKFLOW_STEPS.map((step, i) => {
      const start = -Math.PI / 2 + i * angleStep + PAD_ANGLE / 2;
      const end = -Math.PI / 2 + (i + 1) * angleStep - PAD_ANGLE / 2;
      const mid = (start + end) / 2;
      const labelR = (OUTER_R + INNER_R) / 2;
      const { x: labelX, y: labelY } = polarToCartesian(CX, CY, labelR, mid);
      return { step, path: wedgePath(start, end), labelX, labelY };
    });
  }, [angleStep]);

  const statuses = useMemo(() => computeStepStatuses(progress), [progress]);
  const activeStep = useMemo(
    () => WORKFLOW_STEPS.find((s) => statuses[s.id] === "in_progress") ?? WORKFLOW_STEPS[WORKFLOW_STEPS.length - 1]!,
    [statuses],
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const groupRefs = useRef<(SVGGElement | null)[]>([]);

  function focusSlice(index: number) {
    const wrapped = (index + numSteps) % numSteps;
    groupRefs.current[wrapped]?.focus();
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[480px] select-none">
      <svg
        viewBox="0 0 400 400"
        className="h-full w-full overflow-visible"
        role="group"
        aria-label="Your video's 8-step production workflow"
      >
        <defs>
          {WORKFLOW_STEPS.map((step) => (
            <linearGradient key={step.id} id={`grad-${step.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={step.gradient.from} />
              <stop offset="100%" stopColor={step.gradient.to} />
            </linearGradient>
          ))}
        </defs>

        {slices.map(({ step, path, labelX, labelY }, i) => {
          const status = statuses[step.id] ?? "locked";
          const isHovered = hoveredId === step.id;
          const isActive = status === "in_progress";
          const Icon = step.icon;

          return (
            <g
              key={step.id}
              ref={(el) => {
                groupRefs.current[i] = el;
              }}
              role="button"
              tabIndex={0}
              aria-label={`Step ${step.order + 1}: ${step.title}. ${STATUS_TEXT[status]}.`}
              className="cursor-pointer outline-none"
              onMouseEnter={() => setHoveredId(step.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(step.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => setSelectedStep(step)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStep(step);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  focusSlice(i + 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  focusSlice(i - 1);
                }
              }}
            >
              <motion.path
                d={path}
                fill={`url(#grad-${step.id})`}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1.5}
                strokeLinejoin="round"
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                initial={false}
                animate={{
                  scale: isHovered ? 1.045 : isActive ? 1.02 : 1,
                  opacity: status === "locked" ? 0.55 : 1,
                  filter:
                    isHovered || isActive
                      ? `drop-shadow(0 0 22px ${step.gradient.glow}) drop-shadow(0 6px 14px rgba(0,0,0,0.4))`
                      : "drop-shadow(0 4px 10px rgba(0,0,0,0.35))",
                }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
              />

              <foreignObject x={labelX - 62} y={labelY - 62} width={124} height={124} className="pointer-events-none overflow-visible">
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center text-white">
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-white/30",
                      status === "completed" && "bg-emerald-400 text-emerald-950",
                      status === "in_progress" && "bg-white text-slate-900",
                      status === "ready" && "bg-white/15 text-white",
                      status === "locked" && "bg-black/25 text-white/70",
                    )}
                  >
                    {status === "completed" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : status === "locked" ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      step.order + 1
                    )}
                  </div>
                  <Icon className="h-6 w-6 drop-shadow sm:h-7 sm:w-7" aria-hidden />
                  <p className="max-w-[100px] text-[11px] font-semibold leading-tight drop-shadow sm:text-xs">
                    {step.shortLabel}
                  </p>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>

      <CenterHub
        activeStep={activeStep}
        completionPercent={completionPercent}
        quickActionHref={quickActionHref}
        quickActionLabel={quickActionLabel}
      />

      <StepDetailDialog
        step={selectedStep}
        status={selectedStep ? (statuses[selectedStep.id] ?? "locked") : "locked"}
        href={selectedStep ? stepHref(selectedStep.id, projectId) : "#"}
        onOpenChange={(open) => !open && setSelectedStep(null)}
      />
    </div>
  );
}
