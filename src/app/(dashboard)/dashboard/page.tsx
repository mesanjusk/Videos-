import { redirect } from "next/navigation";

/**
 * The dashboard is gone.
 *
 * It showed six stat tiles (projects by status, jobs by status, an activity feed) — an operations
 * view of a system, on the screen someone lands on right after signing in. What they came to do is
 * make a video, and that lives one click away at /create; what they came to find is a video they
 * already made, and that lives at /projects. Neither of those questions was answered by a count of
 * queued jobs.
 *
 * Kept as a redirect rather than deleted: it was the post-login destination and is linked from
 * bookmarks, the old sidebar and anything else pointing at it.
 */
export default function DashboardPage() {
  redirect("/create");
}
