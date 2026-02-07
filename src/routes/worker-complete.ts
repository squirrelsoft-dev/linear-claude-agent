import { Router } from "express";
import express from "express";
import { workerCallbackPayloadSchema } from "../types/worker-callback.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { workerSpawner } from "../services/worker-spawner.js";

export const workerCompleteRouter = Router();

workerCompleteRouter.use(express.json());

workerCompleteRouter.post("/", (req, res) => {
  const agentKey = req.headers["x-agent-key"];
  if (agentKey !== config.AGENT_KEY) {
    logger.warn("Unauthorized worker callback (invalid or missing x-agent-key)");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

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

  workerSpawner.handleWorkerComplete(payload.issueId);

  // Stub for SQU-10
  res.status(200).json({ received: true });
});
