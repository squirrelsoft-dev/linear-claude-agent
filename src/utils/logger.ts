import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ["GITHUB_TOKEN", "LINEAR_API_KEY", "AGENT_KEY", "ANTHROPIC_API_KEY"],
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});
