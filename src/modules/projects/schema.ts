import { z } from "zod";
import { VIDEO_STYLES } from "./constants";

/** Shared between the wizard's React Hook Form resolver and the POST /api/projects route handler. */
export const createProjectSchema = z
  .object({
    title: z.string().min(2, "Give your project a name").max(120),
    language: z.string().min(2).default("en"),
    videoType: z.string().min(2).default("short"),
    durationSeconds: z.coerce.number().int().min(15).max(600).default(60),
    targetPlatform: z.enum(["youtube", "instagram", "tiktok", "facebook"]).default("youtube"),
    style: z.enum(VIDEO_STYLES).default("Pixar"),
    customStyleDescription: z.string().max(500).optional(),
    storyInputMode: z.enum(["idea", "script"]).default("idea"),
    premise: z.string().max(2000).optional(),
    pastedScript: z.string().max(20000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.style === "Custom" && !data.customStyleDescription?.trim()) {
      ctx.addIssue({ code: "custom", path: ["customStyleDescription"], message: "Describe your custom style" });
    }
    if (data.storyInputMode === "idea" && !data.premise?.trim()) {
      ctx.addIssue({ code: "custom", path: ["premise"], message: "Tell us your idea" });
    }
    if (data.storyInputMode === "script" && !data.pastedScript?.trim()) {
      ctx.addIssue({ code: "custom", path: ["pastedScript"], message: "Paste your script" });
    }
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
