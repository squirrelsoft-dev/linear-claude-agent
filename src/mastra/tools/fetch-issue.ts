import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { linearClient } from "../../services/linear-client.js";

export const fetchIssueTool = createTool({
  id: "fetch-issue",
  description:
    "Fetches full issue details from Linear by issue ID. Use this to get the latest description, comments, and metadata for an issue.",
  inputSchema: z.object({
    issueId: z.string().describe("The Linear issue ID"),
  }),
  outputSchema: z.object({
    identifier: z.string(),
    title: z.string(),
    description: z.string(),
    state: z.string(),
    labels: z.array(z.string()),
    priority: z.number(),
    url: z.string(),
  }),
  execute: async ({ issueId }) => {
    const issue = await linearClient.issue(issueId);
    const labels = await issue.labels();
    const state = await issue.state;

    return {
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      state: state?.name ?? "Unknown",
      labels: labels.nodes.map((l) => l.name),
      priority: issue.priority,
      url: issue.url,
    };
  },
});
