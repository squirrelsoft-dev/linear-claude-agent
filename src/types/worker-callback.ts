import { z } from "zod";

export const workerCallbackPayloadSchema = z.object({
  status: z.enum(["completed", "failed"]),
  branch: z.string(),
  error: z.string().optional(),
  issueId: z.string(),
  issueIdentifier: z.string(),
  issueTitle: z.string(),
  repoUrl: z.string(),
});

export type WorkerCallbackPayload = z.infer<typeof workerCallbackPayloadSchema>;
