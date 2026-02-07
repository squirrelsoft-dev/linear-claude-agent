import { LinearClient } from "@linear/sdk";
import type { LinearWebhookPayload } from "../types/linear-webhook.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { mastra } from "../mastra/index.js";

const linearClient = new LinearClient({ apiKey: config.LINEAR_API_KEY });

function buildBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `ai/${identifier.toLowerCase()}-${slug}`;
}

export async function handleIssueTransitionToInProgress(
  payload: LinearWebhookPayload,
): Promise<void> {
  const issueId = payload.data.id;

  // Fetch full issue details from Linear API
  const issue = await linearClient.issue(issueId);
  const labels = await issue.labels();
  const team = await issue.team;

  const branchName = buildBranchName(
    payload.data.identifier,
    payload.data.title,
  );

  const prompt = [
    `You are a PM agent orchestrating a coding task. A Linear issue has been moved to "In Progress".`,
    ``,
    `Issue: ${payload.data.identifier} - ${payload.data.title}`,
    `Description: ${issue.description ?? "No description provided"}`,
    `Team: ${team?.name ?? "Unknown"}`,
    `Labels: ${labels.nodes.map((l) => l.name).join(", ") || "None"}`,
    `Priority: ${payload.data.priority}`,
    `Branch: ${branchName}`,
    ``,
    `Use the fetch-issue tool if you need more details about this issue.`,
    `Then use the spawn-worker tool to create a Docker container that will implement this issue.`,
    `Pass the issue identifier, title, description, and branch name to the worker.`,
  ].join("\n");

  logger.info(
    { issue: payload.data.identifier, branch: branchName },
    "Invoking PM agent",
  );

  const pmAgent = mastra.getAgent("pmAgent");
  const result = await pmAgent.generate(prompt, { maxSteps: 10 });

  logger.info(
    { issue: payload.data.identifier, response: result.text },
    "PM agent completed",
  );
}
