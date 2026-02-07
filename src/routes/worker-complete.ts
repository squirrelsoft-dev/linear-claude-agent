import { Router } from "express";
import express from "express";
import type { WorkerCallbackPayload } from "../types/worker-callback.js";
import { logger } from "../utils/logger.js";

export const workerCompleteRouter = Router();

workerCompleteRouter.use(express.json());

workerCompleteRouter.post("/", (req, res) => {
  const payload = req.body as WorkerCallbackPayload;

  logger.info(
    { issueId: payload.issueId, status: payload.status, branch: payload.branch },
    "Worker callback received",
  );

  // Stub for SQU-10
  res.status(200).json({ received: true });
});
