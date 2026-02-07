import { LinearClient } from "@linear/sdk";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const linearClient = new LinearClient({ apiKey: config.LINEAR_API_KEY });

let repoGroupId: string | null = null;

export async function initializeRepoLabels(): Promise<void> {
  const groupName = config.REPO_LABEL_GROUP;

  const labels = await linearClient.issueLabels({ first: 250 });
  const group = labels.nodes.find((l) => l.isGroup && l.name === groupName);

  if (!group) {
    throw new Error(
      `No '${groupName}' label group found in your Linear workspace. ` +
        `Create a label group named '${groupName}' with child labels for each repo. ` +
        `Each child label's name should be the repo shortname, and its description should contain the SSH URL ` +
        `(e.g. git@github.com:org/repo.git). See README for setup instructions.`,
    );
  }

  repoGroupId = group.id;
  logger.info({ groupName, groupId: repoGroupId }, "Repo label group resolved");
}

export async function resolveRepoUrl(issueId: string): Promise<string | null> {
  if (!repoGroupId) {
    throw new Error("Repo label service not initialized — call initializeRepoLabels() first");
  }

  const issue = await linearClient.issue(issueId);
  const labels = await issue.labels();

  for (const label of labels.nodes) {
    if (label.parentId === repoGroupId) {
      if (!label.description) {
        logger.warn(
          { label: label.name, issueId },
          "Repo label found but has no description (expected SSH URL)",
        );
        return null;
      }
      return label.description;
    }
  }

  return null;
}
