import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { spawnWorkerContainer } from "../../services/docker.service.js";

export const spawnWorkerTool = createTool({
  id: "spawn-worker",
  description:
    "Spawns a Docker worker container to implement a Linear issue. The worker will clone the repo, create a branch, implement the changes, and POST a callback when done.",
  inputSchema: z.object({
    issueId: z.string().describe("The Linear issue ID"),
    identifier: z.string().describe("The issue identifier (e.g. SQU-8)"),
    title: z.string().describe("The issue title"),
    description: z.string().describe("The issue description / task prompt"),
    branch: z.string().describe("The git branch name for the worker"),
  }),
  outputSchema: z.object({
    containerId: z.string(),
  }),
  execute: async ({ issueId, identifier, title, description, branch }) => {
    const result = await spawnWorkerContainer({
      issueId,
      identifier,
      title,
      description,
      branch,
    });
    return result;
  },
});
