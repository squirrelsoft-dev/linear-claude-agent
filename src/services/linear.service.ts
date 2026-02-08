import type { LinearWebhookPayload } from "../types/linear-webhook.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { mastra } from "../mastra/index.js";
import { resolveRepoUrl } from "./repo-label.service.js";
import { linearClient } from "./linear-client.js";

export async function handleIssueTransitionToInProgress(
  payload: LinearWebhookPayload,
): Promise<void> {
  const issueId = payload.data.id;

  // Resolve repo URL from label group
  const repoUrl = await resolveRepoUrl(issueId);

  // Fetch full issue details (shared across both branches)
  const issue = await linearClient.issue(issueId);
  const team = await issue.team;

  if (!repoUrl) {
    const groupName = config.REPO_LABEL_GROUP;
    await linearClient.createComment({
      issueId,
      body: `No repo label found — add a label from the **${groupName}** group and move back to In Progress.`,
    });

    // Move issue back to Todo
    if (team) {
      const states = await team.states();
      const todoState = states.nodes.find((s) => s.name === "Todo");
      if (todoState) {
        await linearClient.updateIssue(issueId, { stateId: todoState.id });
      }
    }

    logger.warn(
      { issue: payload.data.identifier },
      "No repo label found, moved back to Todo",
    );
    return;
  }

  const labels = await issue.labels();

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
