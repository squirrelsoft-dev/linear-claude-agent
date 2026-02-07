import { z } from "zod";

export const workerCallbackPayloadSchema = z.object({
  status: z.enum(["success", "failure"]),
  branch: z.string(),
  error: z.string().optional(),
  issueId: z.string(),
});

export type WorkerCallbackPayload = z.infer<typeof workerCallbackPayloadSchema>;
