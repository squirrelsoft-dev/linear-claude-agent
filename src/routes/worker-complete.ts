import { Router } from "express";
import express from "express";
import { workerCallbackPayloadSchema } from "../types/worker-callback.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { workerSpawner } from "../services/worker-spawner.js";
import { handleCompleted, handleFailed } from "../services/completion.service.js";

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

  // Respond immediately so the worker isn't blocked
  res.status(200).json({ received: true });

  // Clear worker tracking
  workerSpawner.handleWorkerComplete(payload.issueId);

  // Fire-and-forget: dispatch based on status
  const handler = payload.status === "completed" ? handleCompleted : handleFailed;
  handler(payload).catch((err) => {
    logger.error({ err, issueId: payload.issueId, status: payload.status }, "Completion handler error");
  });
});
