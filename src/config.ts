import { z } from "zod";

const envSchema = z.object({
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  REPO_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  WORKER_IMAGE: z.string().default("claude-worker:latest"),
  WORKER_NETWORK: z.string().default("pm-agent-net"),
  WORKER_TIMEOUT: z.coerce.number().default(1800),
  WORKER_MAX_TURNS: z.coerce.number().default(50),
  CALLBACK_BASE_URL: z.string().default("http://pm-agent:3000"),
  HOST_SSH_PATH: z.string().default("/root/.ssh"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
