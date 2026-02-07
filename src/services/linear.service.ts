import { LinearClient } from "@linear/sdk";
import type { LinearWebhookPayload } from "../types/linear-webhook.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { mastra } from "../mastra/index.js";

const linearClient = new LinearClient({ apiKey: config.LINEAR_API_KEY });

export async function handleIssueTransitionToInProgress(
  payload: LinearWebhookPayload,
): Promise<void> {
  const issueId = payload.data.id;

  // Fetch full issue details from Linear API
  const issue = await linearClient.issue(issueId);
  const labels = await issue.labels();
  const team = await issue.team;

  const prompt = [
    `You are a PM agent orchestrating a coding task. A Linear issue has been moved to "In Progress".`,
    ``,
    `Issue: ${payload.data.identifier} - ${payload.data.title}`,
    `Description: ${issue.description ?? "No description provided"}`,
    `Team: ${team?.name ?? "Unknown"}`,
    `Labels: ${labels.nodes.map((l) => l.name).join(", ") || "None"}`,
    `Priority: ${payload.data.priority}`,
    ``,
    `Use the fetch-issue tool if you need more details about this issue.`,
    `Then use the spawn-worker tool to create a Docker container that will implement this issue.`,
    `Pass the issue ID, identifier, title, and description to the worker. The branch name will be auto-generated.`,
  ].join("\n");

  logger.info({ issue: payload.data.identifier }, "Invoking PM agent");

  const pmAgent = mastra.getAgent("pmAgent");
  const result = await pmAgent.generate(prompt, { maxSteps: 10 });

  logger.info(
    { issue: payload.data.identifier, response: result.text },
    "PM agent completed",
  );
}
