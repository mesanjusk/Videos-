import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  label: string;
  description: string;
}

interface StepperProps {
  steps: Step[];
  currentIndex: number;
}

/** Always shows the user where they are and what's next — never leaves them wondering "what do I do next?" */
export function Stepper({ steps, currentIndex }: StepperProps) {
  return (
    <ol className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:gap-0">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={step.label} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-stretch">
            <div className="flex items-center gap-3 sm:w-full">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                  isComplete && "border-primary bg-primary text-primary-foreground",
                  isCurrent && "border-primary text-primary",
                  !isComplete && !isCurrent && "border-border text-muted-foreground",
                )}
              >
                {isComplete ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              {index < steps.length - 1 && <div className={cn("hidden h-px flex-1 sm:block", isComplete ? "bg-primary" : "bg-border")} />}
            </div>
            <div className="pl-11 sm:pl-0 sm:pt-2">
              <p className={cn("text-sm font-medium", isCurrent ? "text-foreground" : "text-muted-foreground")}>{step.label}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
