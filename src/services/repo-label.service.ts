import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { linearClient } from "./linear-client.js";

let repoGroupId: string | null = null;

export async function initializeRepoLabels(): Promise<void> {
  const groupName = config.REPO_LABEL_GROUP;

  const labels = await linearClient.issueLabels({
    filter: { name: { eq: groupName }, isGroup: { eq: true } },
  });
  const group = labels.nodes[0];

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

  const repoLabels = labels.nodes.filter((l) => l.parentId === repoGroupId);

  if (repoLabels.length === 0) {
    return null;
  }

  if (repoLabels.length > 1) {
    logger.warn(
      { issueId, labels: repoLabels.map((l) => l.name) },
      "Multiple repo labels found on issue, using first",
    );
  }

  const repoLabel = repoLabels[0];
  if (!repoLabel.description) {
    logger.warn(
      { label: repoLabel.name, issueId },
      "Repo label found but has no description (expected SSH URL)",
    );
    return null;
  }

  return repoLabel.description;
}
