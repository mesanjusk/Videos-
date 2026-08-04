import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import type { JobType } from "@/modules/jobs/models/Job";

const queues = new Map<JobType, Queue>();

/** One BullMQ Queue per job type — lazily created and cached (module scope survives warm invocations). */
export function getQueue(type: JobType): Queue {
  let queue = queues.get(type);
  if (!queue) {
    queue = new Queue(type, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 days
        removeOnFail: { age: 60 * 60 * 24 * 30 }, // 30 days
      },
    });
    queues.set(type, queue);
  }
  return queue;
}
