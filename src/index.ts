import express from "express";
import crypto from "crypto";
import { execFile, execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const WORK_DIR = path.join("/app", ".work");
mkdirSync(WORK_DIR, { recursive: true });

const app = express();

const PORT = parseInt(process.env.PORT || "3000", 10);
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const AGENT_KEY = process.env.AGENT_KEY;
const BOUNCE_WINDOW_MS = 60_000; // ignore "In Progress" transitions within 60s of completion

// Track recently completed issues to suppress bounce-back webhooks
// (e.g. GitHub integration auto-moving issues back to In Progress after PR creation)
const recentlyCompleted = new Map<string, number>();

// Track in-flight Claude sessions per issue to prevent webhook feedback loops.
// When Claude modifies an issue (adds labels, posts comments, changes state),
// Linear fires new webhooks — without dedup, we'd spawn parallel sessions for
// the same issue that race and duplicate work.
const inFlight = new Map<string, { identifier: string; startedAt: number }>();

if (!LINEAR_WEBHOOK_SECRET) {
  console.error("FATAL: LINEAR_WEBHOOK_SECRET is required");
  process.exit(1);
}

if (!AGENT_KEY) {
  console.error("FATAL: AGENT_KEY is required");
  process.exit(1);
}

// Verify Docker socket is accessible at startup (required for spawning workers)
try {
  execFileSync("docker", ["info"], { timeout: 10_000, stdio: "pipe" });
  console.log(JSON.stringify({ event: "docker_check", status: "ok", timestamp: new Date().toISOString() }));
} catch (e) {
  console.error(
    JSON.stringify({
      event: "docker_check",
      status: "failed",
      error: (e as Error).message,
      hint: "Set DOCKER_GID in .env to match: stat -c '%g' /var/run/docker.sock on host",
      timestamp: new Date().toISOString(),
    }),
  );
  // Don't exit — triage/review skills work without Docker, only implement needs it
}

// Log incoming requests (skip health checks to reduce noise)
app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log(
      JSON.stringify({
        event: "request_received",
        method: req.method,
        path: req.path,
        timestamp: new Date().toISOString(),
      }),
    );
  }
  next();
});

// Capture raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.post("/api/linear/webhook", (req, res) => {
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody) {
    console.error(JSON.stringify({ event: "webhook_rejected", reason: "no_body" }));
    res.status(400).json({ error: "No body" });
    return;
  }

  // Verify webhook signature
  const signature = req.headers["linear-signature"] as string | undefined;
  if (!signature) {
    console.error(JSON.stringify({ event: "webhook_rejected", reason: "missing_signature" }));
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
    console.error(JSON.stringify({ event: "webhook_rejected", reason: "invalid_signature" }));
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

  // Dedup: skip if a Claude session is already running for this issue
  if (issueId && inFlight.has(issueId)) {
    const existing = inFlight.get(issueId)!;
    console.log(
      JSON.stringify({
        event: "webhook_deduplicated",
        identifier,
        issueId,
        reason: `Session already in-flight since ${new Date(existing.startedAt).toISOString()}`,
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      event: "webhook_received",
      action,
      type,
      identifier,
      timestamp: new Date().toISOString(),
    }),
  );

  // Write payload to file to avoid CLI argument size limits
  const payloadFile = path.join(WORK_DIR, `webhook-${identifier}-${Date.now()}.json`);
  writeFileSync(payloadFile, JSON.stringify(req.body));

  // Invoke Claude Code with state machine skill (lightweight router — spawns containers for actual work)
  const SM_MAX_TURNS = 15;
  const SM_TIMEOUT = 120_000; // 2 minutes — routing only
  const smArgs = [
    "-p",
    `Read the Linear webhook payload from ${payloadFile} and follow .claude/skills/state-machine.md`,
    "--dangerously-skip-permissions",
    "--max-turns",
    String(SM_MAX_TURNS),
  ];

  console.log(
    JSON.stringify({
      event: "claude_invoke",
      skill: "state-machine",
      identifier,
      timestamp: new Date().toISOString(),
    }),
  );

  if (issueId) inFlight.set(issueId, { identifier, startedAt: Date.now() });

  execFile(
    "claude",
    smArgs,
    { cwd: "/app", timeout: SM_TIMEOUT, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ISSUE_ID: issueId, ISSUE_IDENTIFIER: identifier } },
    (error, stdout, stderr) => {
      if (issueId) inFlight.delete(issueId);

      if (error) {
        const err = error as Error & { killed?: boolean; signal?: string; code?: number };
        console.error(
          JSON.stringify({
            event: "state_machine_error",
            identifier,
            error: err.message,
            killed: err.killed ?? false,
            signal: err.signal ?? null,
            exitCode: err.code ?? null,
            reason: err.killed ? `Process killed (signal=${err.signal}, likely timeout after ${SM_TIMEOUT / 1000}s)` : `Exited with code ${err.code}`,
            stdout: stdout?.slice(-3000),
            stderr: stderr?.slice(-3000),
            timestamp: new Date().toISOString(),
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            event: "state_machine_complete",
            identifier,
            output: stdout?.slice(-500),
            timestamp: new Date().toISOString(),
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

  // Write payload to file to avoid CLI argument size limits
  const payloadFile = path.join(WORK_DIR, `callback-${identifier}-${Date.now()}.json`);
  writeFileSync(payloadFile, JSON.stringify(req.body));

  // Spawn completion skill in isolated container
  const spawnArgs = [".claude/scripts/spawn-skill.sh", "completion", payloadFile];

  console.log(
    JSON.stringify({
      event: "spawn_skill",
      skill: "completion",
      identifier,
      timestamp: new Date().toISOString(),
    }),
  );

  execFile(
    "bash",
    spawnArgs,
    { cwd: "/app", timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ISSUE_ID: issueId, ISSUE_IDENTIFIER: identifier } },
    (error, stdout, stderr) => {
      if (error) {
        const err = error as Error & { killed?: boolean; signal?: string; code?: number };
        console.error(
          JSON.stringify({
            event: "completion_spawn_error",
            identifier,
            error: err.message,
            killed: err.killed ?? false,
            signal: err.signal ?? null,
            exitCode: err.code ?? null,
            stdout: stdout?.slice(-3000),
            stderr: stderr?.slice(-3000),
            timestamp: new Date().toISOString(),
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            event: "completion_spawned",
            identifier,
            output: stdout?.trim(),
            timestamp: new Date().toISOString(),
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
