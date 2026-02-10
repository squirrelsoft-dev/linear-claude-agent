import express from "express";
import crypto from "crypto";
import fs from "fs";
import { exec } from "child_process";

const app = express();

const PORT = parseInt(process.env.PORT || "3000", 10);
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "50", 10);

if (!LINEAR_WEBHOOK_SECRET) {
  console.error("FATAL: LINEAR_WEBHOOK_SECRET is required");
  process.exit(1);
}

// Capture raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.post("/webhook/linear", (req, res) => {
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody) {
    res.status(400).json({ error: "No body" });
    return;
  }

  // Verify webhook signature
  const signature = req.headers["linear-signature"] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  // Replay attack protection
  const timestampHeader = req.headers["linear-delivery-timestamp"] as string | undefined;
  if (timestampHeader) {
    const timestamp = Number(timestampHeader);
    // 1 minute tolerance
    if (Date.now() - timestamp > 60_000) {
      console.error(
        JSON.stringify({ event: "webhook_stale", identifier: req.body?.data?.identifier }),
      );
      res.status(401).json({ error: "Timestamp too old" });
      return;
    }
  }

  const hmac = crypto.createHmac("sha256", LINEAR_WEBHOOK_SECRET!);
  hmac.update(rawBody);
  const expected = hmac.digest();
  const provided = Buffer.from(signature, "hex");

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Respond immediately so Linear doesn't retry
  res.json({ received: true });

  // Write payload to temp file to avoid shell escaping issues
  const payloadFile = `/tmp/webhook-${Date.now()}.json`;
  fs.writeFileSync(payloadFile, JSON.stringify(req.body));

  const action = req.body?.action || "unknown";
  const type = req.body?.type || "unknown";
  const identifier = req.body?.data?.identifier || "unknown";

  console.log(
    JSON.stringify({
      event: "webhook_received",
      action,
      type,
      identifier,
      timestamp: new Date().toISOString(),
    }),
  );

  // Invoke Claude Code with state machine skill
  exec(
    `claude -p "/state-machine $(cat ${payloadFile})" --dangerously-skip-permissions --max-turns ${MAX_TURNS}`,
    { cwd: "/app", timeout: 300_000 },
    (error, stdout, stderr) => {
      // Clean up temp file
      try {
        fs.unlinkSync(payloadFile);
      } catch {
        // ignore cleanup errors
      }

      if (error) {
        console.error(
          JSON.stringify({
            event: "state_machine_error",
            identifier,
            error: error.message,
            stderr: stderr?.slice(-500),
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            event: "state_machine_complete",
            identifier,
            output: stdout?.slice(-500),
          }),
        );
      }
    },
  );
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      event: "server_started",
      port: PORT,
      timestamp: new Date().toISOString(),
    }),
  );
});
