import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  workerSpawner,
  WorkerAlreadyRunningError,
  MaxConcurrencyError,
} from "../../services/worker-spawner.js";
import { resolveRepoUrl } from "../../services/repo-label.service.js";

export const spawnWorkerTool = createTool({
  id: "spawn-worker",
  description:
    "Spawns a Docker worker container to implement a Linear issue. The worker will clone the repo (resolved from the issue's repo label), create a branch, implement the changes, and POST a callback when done. The branch name is auto-generated.",
  inputSchema: z.object({
    issueId: z.string().describe("The Linear issue ID"),
    identifier: z.string().describe("The issue identifier (e.g. SQU-8)"),
    title: z.string().describe("The issue title"),
    description: z.string().describe("The issue description / task prompt"),
  }),
  outputSchema: z.object({
    containerId: z.string(),
    branchName: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ issueId, identifier, title, description }) => {
    try {
      const repoUrl = await resolveRepoUrl(issueId);
      if (!repoUrl) {
        return { containerId: "", branchName: "", error: "No repo label found on issue" };
      }

      const result = await workerSpawner.spawn({
        issueId,
        identifier,
        title,
        taskDescription: description,
        repoUrl,
      });
      return { containerId: result.containerId, branchName: result.branchName };
    } catch (err) {
      if (
        err instanceof WorkerAlreadyRunningError ||
        err instanceof MaxConcurrencyError
      ) {
        return { containerId: "", branchName: "", error: err.message };
      }
      throw err;
    }
  },
});
