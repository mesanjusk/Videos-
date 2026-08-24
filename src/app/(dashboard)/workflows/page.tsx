import Link from "next/link";
import { requireUserId } from "@/core/auth/session";
import { listWorkflows, listAutomations, listAutomationTasks, listSchedules } from "@/modules/automation/service";
import { HelpButton } from "@/components/shared/help-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Workflow as WorkflowIcon } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The workflow half of the browser-automation subsystem, brought over from Browser Automation OS.
 *
 * Deliberately read-only for now. The engine, persistence, scheduler, credentials and API are all
 * in place and working; a visual node editor is a substantial piece of UI in its own right, and
 * shipping a half-built one would be worse than showing the state honestly and letting workflows be
 * created through the API in the meantime. See docs/BROWSER-AUTOMATION.md.
 */
export default async function WorkflowsPage() {
  const userId = await requireUserId();
  const [workflows, automations, tasks, schedules] = await Promise.all([
    listWorkflows(userId),
    listAutomations(userId),
    listAutomationTasks(userId, 20),
    listSchedules(userId),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <HelpButton text="Versioned browser-automation workflows and the automations that run them. A workflow is the node graph; an automation binds it to a browser session and default inputs; a task is one run. Schedules enqueue automations on a cadence — swept by the worker, not the serverless tick." />
      </div>

      {workflows.length === 0 && automations.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Workflows are created through POST /api/v1/workflows. Each save is an immutable version, and a running task pins the version it started with, so editing never changes an in-flight run."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Workflows" count={workflows.length}>
            {workflows.map((workflow) => (
              <Row
                key={String(workflow._id)}
                title={workflow.name}
                subtitle={workflow.description ?? `Version ${workflow.currentVersion ?? 0}`}
                badge={workflow.status ?? "draft"}
              />
            ))}
          </Section>

          <Section title="Automations" count={automations.length}>
            {automations.map((automation) => (
              <Row
                key={String(automation._id)}
                title={automation.name}
                subtitle={(automation.workflowId as unknown as { name?: string } | null)?.name ?? "No workflow"}
                badge={automation.enabled ? "enabled" : "disabled"}
              />
            ))}
          </Section>

          <Section title="Recent runs" count={tasks.length}>
            {tasks.map((task) => (
              <Row
                key={String(task._id)}
                title={(task.automationId as unknown as { name?: string } | null)?.name ?? "Automation run"}
                subtitle={task.currentStepId ? `Last step: ${task.currentStepId}` : task.source ?? ""}
                badge={task.status ?? "QUEUED"}
              />
            ))}
          </Section>

          <Section title="Schedules" count={schedules.length}>
            {schedules.map((schedule) => (
              <Row
                key={String(schedule._id)}
                title={(schedule.automationId as unknown as { name?: string } | null)?.name ?? "Schedule"}
                subtitle={
                  schedule.nextRunAt ? `Next run ${new Date(schedule.nextRunAt).toLocaleString()}` : "Not scheduled"
                }
                badge={schedule.frequency}
              />
            ))}
          </Section>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Browser runs execute on the worker process, never in a serverless function. See{" "}
        <Link href="/browser-automation" className="underline">
          Browser Automation
        </Link>{" "}
        for individual task runs and their step-by-step logs.
      </p>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          {title}
          <span className="text-xs text-muted-foreground">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {count === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : children}
      </CardContent>
    </Card>
  );
}

function Row({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {badge && <Badge variant="outline" className="shrink-0 text-xs">{badge}</Badge>}
    </div>
  );
}
