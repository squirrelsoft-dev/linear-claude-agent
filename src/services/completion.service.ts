import { LinearClient } from "@linear/sdk";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { parseRepoUrl, findExistingPr, createPr } from "./github.service.js";
import type { WorkerCallbackPayload } from "../types/worker-callback.js";

const linearClient = new LinearClient({ apiKey: config.LINEAR_API_KEY });

export async function handleCompleted(payload: WorkerCallbackPayload): Promise<void> {
  const { owner, repo } = parseRepoUrl(payload.repoUrl || config.REPO_URL);

  // Check for existing PR
  let prUrl: string;
  const existing = await findExistingPr(owner, repo, payload.branch);
  if (existing) {
    prUrl = existing.url;
    logger.info({ prUrl, branch: payload.branch }, "Existing PR found");
  } else {
    const pr = await createPr(owner, repo, {
      title: payload.issueTitle,
      body: `Resolves [${payload.issueIdentifier}](https://linear.app/issue/${payload.issueIdentifier})`,
      head: payload.branch,
      base: config.BASE_BRANCH,
    });
    prUrl = pr.url;
    logger.info({ prUrl, branch: payload.branch }, "PR created");
  }

  // Update Linear issue status to "In Review"
  const issue = await linearClient.issue(payload.issueId);
  const team = await issue.team;
  if (team) {
    const states = await team.states();
    const inReviewState = states.nodes.find((s) => s.name === "In Review");
    if (inReviewState) {
      await linearClient.updateIssue(payload.issueId, { stateId: inReviewState.id });
      logger.info({ issueId: payload.issueId }, "Issue moved to In Review");
    } else {
      logger.warn({ issueId: payload.issueId }, "No 'In Review' state found");
    }
  }

  // Post comment on Linear issue
  await linearClient.createComment({
    issueId: payload.issueId,
    body: `🤖 Worker completed successfully.\n\n**Branch:** \`${payload.branch}\`\n**PR:** ${prUrl}`,
  });
}

export async function handleFailed(payload: WorkerCallbackPayload): Promise<void> {
  // Post comment with error details
  await linearClient.createComment({
    issueId: payload.issueId,
    body: `🤖 Worker failed.\n\n**Branch:** \`${payload.branch}\`\n**Error:** ${payload.error || "Unknown error"}`,
  });

  // Find or create "agent-failed" label and apply it
  await applyAgentFailedLabel(payload.issueId);
}

export async function handleTimeout(issueId: string, identifier: string): Promise<void> {
  await linearClient.createComment({
    issueId,
    body: `🤖 Worker for ${identifier} timed out after ${config.WORKER_TIMEOUT}s.`,
  });

  await applyAgentFailedLabel(issueId);
}

async function applyAgentFailedLabel(issueId: string): Promise<void> {
  const issue = await linearClient.issue(issueId);
  const team = await issue.team;
  if (!team) return;

  // Find existing "agent-failed" label
  const teamLabels = await team.labels();
  let label = teamLabels.nodes.find((l) => l.name === "agent-failed");

  // Create if it doesn't exist
  if (!label) {
    const created = await linearClient.createIssueLabel({
      name: "agent-failed",
      teamId: team.id,
      color: "#e74c3c",
    });
    const labelPayload = await created.issueLabel;
    if (!labelPayload) {
      logger.warn("Failed to create agent-failed label");
      return;
    }
    label = labelPayload;
  }

  // Apply label to issue
  const existingLabels = await issue.labels();
  const labelIds = existingLabels.nodes.map((l) => l.id);
  if (!labelIds.includes(label.id)) {
    labelIds.push(label.id);
    await linearClient.updateIssue(issueId, { labelIds });
  }
}
