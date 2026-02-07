import { Router } from "express";
import type { LinearWebhookPayload } from "../types/linear-webhook.js";
import { handleIssueTransitionToInProgress } from "../services/linear.service.js";
import { logger } from "../utils/logger.js";

export const linearWebhookRouter = Router();

linearWebhookRouter.post("/", (req, res) => {
  const payload = req.body as LinearWebhookPayload;

  // Respond immediately so Linear doesn't retry
  res.status(200).json({ received: true });

  // Filter: only Issue updates where state changed to "In Progress"
  if (payload.type !== "Issue") {
    logger.debug({ type: payload.type }, "Ignoring non-Issue webhook");
    return;
  }

  if (payload.action !== "update") {
    logger.debug({ action: payload.action }, "Ignoring non-update action");
    return;
  }

  if (!payload.updatedFrom?.stateId) {
    logger.debug("Ignoring update without state change");
    return;
  }

  if (payload.data.state.name !== "In Progress") {
    logger.debug(
      { state: payload.data.state.name },
      "Ignoring non-In Progress state",
    );
    return;
  }

  logger.info(
    { issue: payload.data.identifier, title: payload.data.title },
    "Issue transitioned to In Progress",
  );

  handleIssueTransitionToInProgress(payload).catch((err) => {
    logger.error({ err, issue: payload.data.identifier }, "Failed to handle issue transition");
  });
});
