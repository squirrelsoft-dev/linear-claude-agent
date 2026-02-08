import express from "express";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import {
  captureRawBody,
  verifyLinearSignature,
} from "./middleware/verify-linear-signature.js";
import { linearWebhookRouter } from "./routes/linear-webhook.js";
import { workerCompleteRouter } from "./routes/worker-complete.js";
import { workerSpawner } from "./services/worker-spawner.js";
import { initializeRepoLabels } from "./services/repo-label.service.js";

await workerSpawner.initialize();
await initializeRepoLabels();

const app = express();

// Health check — no body parsing needed
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Linear webhook route — needs raw body for signature verification
app.use(
  "/api/linear/webhook",
  express.json({ verify: captureRawBody }),
  verifyLinearSignature,
  linearWebhookRouter,
);

// Worker callback route — has its own body parser
app.use("/api/worker/complete", workerCompleteRouter);

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "PM agent server started");
});
