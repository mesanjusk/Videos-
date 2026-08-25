import parser from "cron-parser";
import { connectToDatabase } from "@/core/db/mongoose";
import { Schedule } from "@/modules/automation/models/Schedule";
import { Automation } from "@/modules/automation/models/Automation";
import { Workflow } from "@/modules/automation/models/Workflow";
import { runAutomation } from "@/modules/automation/service";

const CHECK_INTERVAL_MS = 60_000;

export function computeNextRun(
  frequency: string,
  cronExpression: string | undefined,
  from: Date,
  timezone: string,
): Date {
  switch (frequency) {
    case "HOURLY":
      return new Date(from.getTime() + 60 * 60 * 1000);
    case "DAILY":
      return new Date(from.getTime() + 24 * 60 * 60 * 1000);
    case "WEEKLY":
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "CRON": {
      if (!cronExpression) return new Date(from.getTime() + 24 * 60 * 60 * 1000);
      return parser.parseExpression(cronExpression, { currentDate: from, tz: timezone }).next().toDate();
    }
    default:
      return from;
  }
}

/**
 * Sweeps the Schedule collection once a minute and enqueues anything due.
 *
 * Ported from Browser Automation OS's worker. Deliberately DB-polling rather than a cron daemon or
 * a hosted scheduler, so the platform's infrastructure requirement stays MongoDB + Redis.
 *
 * **Only ever started from `worker.ts`.** It must never run inside the Vercel serverless queue tick
 * (`core/queue/worker-runtime.ts`): that function is invoked on every enqueue and by cron, and a
 * scheduler sweep living inside it would fire on each warm invocation, running schedules many
 * times over. This is the same isolation rule `worker-only-processors.ts` enforces for Playwright,
 * for a different reason.
 *
 * A due schedule whose automation is disabled, deleted, or whose workflow has no published version
 * is *rescheduled rather than retried* — otherwise it stays permanently due and the sweep retries
 * it every minute forever.
 */
export function startScheduler(): NodeJS.Timeout {
  const tick = async () => {
    try {
      await connectToDatabase();
      const due = await Schedule.find({ enabled: true, nextRunAt: { $lte: new Date() } }).limit(100);

      for (const schedule of due) {
        const reschedule = async () => {
          schedule.lastRunAt = new Date();
          if (schedule.frequency === "ONCE") schedule.enabled = false;
          else schedule.nextRunAt = computeNextRun(schedule.frequency, schedule.cronExpression ?? undefined, new Date(), schedule.timezone ?? "UTC");
          await schedule.save();
        };

        const automation = await Automation.findOne({ _id: schedule.automationId, userId: schedule.userId }).lean();
        if (!automation?.enabled) {
          await reschedule();
          continue;
        }

        const workflow = await Workflow.findOne({ _id: automation.workflowId, userId: schedule.userId }).lean();
        if (!workflow?.publishedVersionId) {
          console.warn(`[scheduler] schedule ${schedule._id}: workflow has no published version — skipping this run`);
          await reschedule();
          continue;
        }

        try {
          const { task } = await runAutomation(
            schedule.userId,
            String(schedule.automationId),
            (schedule.input as Record<string, unknown>) ?? {},
            "schedule",
          );
          console.log(`[scheduler] enqueued task ${task._id} for schedule ${schedule._id} (${automation.name})`);
        } catch (err) {
          console.error(`[scheduler] schedule ${schedule._id} failed to enqueue:`, err);
        }
        await reschedule();
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };

  void tick();
  return setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
