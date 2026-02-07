import { Router } from "express";
import express from "express";
import { workerCallbackPayloadSchema } from "../types/worker-callback.js";
import { logger } from "../utils/logger.js";

export const workerCompleteRouter = Router();

workerCompleteRouter.use(express.json());

workerCompleteRouter.post("/", (req, res) => {
  const parsed = workerCallbackPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ error: parsed.error.format() }, "Invalid worker callback payload");
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const payload = parsed.data;

  logger.info(
    { issueId: payload.issueId, status: payload.status, branch: payload.branch },
    "Worker callback received",
  );

  // Stub for SQU-10
  res.status(200).json({ received: true });
});
