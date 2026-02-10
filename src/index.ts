import express from "express";
import crypto from "crypto";
import fs from "fs";
import { execFile } from "child_process";

const app = express();

const PORT = parseInt(process.env.PORT || "3000", 10);
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const AGENT_KEY = process.env.AGENT_KEY;
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "50", 10);
const BOUNCE_WINDOW_MS = 60_000; // ignore "In Progress" transitions within 60s of completion

// Track recently completed issues to suppress bounce-back webhooks
// (e.g. GitHub integration auto-moving issues back to In Progress after PR creation)
const recentlyCompleted = new Map<string, number>();

if (!LINEAR_WEBHOOK_SECRET) {
  console.error("FATAL: LINEAR_WEBHOOK_SECRET is required");
  process.exit(1);
}

if (!AGENT_KEY) {
  console.error("FATAL: AGENT_KEY is required");
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

  const action = req.body?.action || "unknown";
  const type = req.body?.type || "unknown";
  const identifier = req.body?.data?.identifier || "unknown";
  const issueId = req.body?.data?.id;
  const stateName = req.body?.data?.state?.name;
  const hadStateChange = !!req.body?.updatedFrom?.stateId;

  // Bounce-back suppression: if this issue was recently completed and is now
  // transitioning to "In Progress", ignore it — this is a side-effect of
  // integrations (e.g. GitHub) auto-moving the issue after PR creation.
  if (issueId && hadStateChange && stateName === "In Progress") {
    const completedAt = recentlyCompleted.get(issueId);
    if (completedAt && Date.now() - completedAt < BOUNCE_WINDOW_MS) {
      console.log(
        JSON.stringify({
          event: "webhook_bounce_suppressed",
          identifier,
          issueId,
          completedAgoMs: Date.now() - completedAt,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }
  }

  // Write payload to temp file to avoid shell escaping issues
  const payloadFile = `/tmp/webhook-${Date.now()}.json`;
  fs.writeFileSync(payloadFile, JSON.stringify(req.body));

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
  execFile(
    "claude",
    [
      "-p",
      `Read the webhook payload from ${payloadFile} and follow .claude/skills/state-machine.md`,
      "--dangerously-skip-permissions",
      "--max-turns",
      String(MAX_TURNS),
    ],
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

app.post("/api/worker/complete", (req, res) => {
  // Validate agent key
  const agentKey = req.headers["x-agent-key"] as string | undefined;
  if (!agentKey || agentKey !== AGENT_KEY) {
    res.status(401).json({ error: "Invalid or missing agent key" });
    return;
  }

  // Validate required fields
  const { status, branch, issueId } = req.body || {};
  if (!status || !branch || !issueId) {
    res.status(400).json({ error: "Missing required fields: status, branch, issueId" });
    return;
  }

  // Respond immediately
  res.json({ received: true });

  // Track completed issues for bounce-back suppression
  if (status === "completed") {
    recentlyCompleted.set(issueId, Date.now());
    // Clean up old entries to prevent memory leaks
    for (const [id, ts] of recentlyCompleted) {
      if (Date.now() - ts > BOUNCE_WINDOW_MS) recentlyCompleted.delete(id);
    }
  }

  const identifier = req.body?.issueIdentifier || "unknown";

  console.log(
    JSON.stringify({
      event: "callback_received",
      status,
      branch,
      issueId,
      identifier,
      timestamp: new Date().toISOString(),
    }),
  );

  // Write callback payload to temp file
  const payloadFile = `/tmp/callback-${Date.now()}.json`;
  fs.writeFileSync(payloadFile, JSON.stringify(req.body));

  // Invoke Claude Code with completion skill
  execFile(
    "claude",
    [
      "-p",
      `Read the worker callback payload from ${payloadFile} and follow .claude/skills/completion.md`,
      "--dangerously-skip-permissions",
      "--max-turns",
      String(MAX_TURNS),
    ],
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
            event: "completion_error",
            identifier,
            error: error.message,
            stderr: stderr?.slice(-500),
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            event: "completion_complete",
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
