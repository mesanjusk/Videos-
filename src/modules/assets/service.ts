import { connectToDatabase } from "@/core/db/mongoose";
import { Asset } from "./models/Asset";

export async function getStorageUsageBytes(userId: string): Promise<number> {
  await connectToDatabase();
  const [row] = await Asset.aggregate<{ total: number }>([
    { $match: { userId } },
    { $group: { _id: null, total: { $sum: "$bytes" } } },
  ]);
  return row?.total ?? 0;
}

export async function listRecentFinalVideos(userId: string, limit = 6) {
  await connectToDatabase();
  return Asset.find({ userId, kind: "final_video" }).sort({ createdAt: -1 }).limit(limit).lean();
}
