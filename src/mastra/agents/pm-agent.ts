import { Agent } from "@mastra/core/agent";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { fetchIssueTool } from "../tools/fetch-issue.js";
import { spawnWorkerTool } from "../tools/spawn-worker.js";
import { config } from "../../config.js";

function createModel() {
  const providerOpts = {
    ...(config.PM_AGENT_API_KEY && { apiKey: config.PM_AGENT_API_KEY }),
    ...(config.PM_AGENT_API_URL && { baseURL: config.PM_AGENT_API_URL }),
  };

  if (config.PM_AGENT_PROVIDER === "openai") {
    return createOpenAI(providerOpts)(config.PM_AGENT_MODEL);
  }
  return createAnthropic(providerOpts)(config.PM_AGENT_MODEL);
}

export const pmAgent = new Agent({
  id: "pm-agent",
  name: "pm-agent",
  instructions: [
    "You are a PM agent that orchestrates coding workers for Linear issues.",
    "When given an issue, analyze the requirements and spawn a worker container to implement it.",
    "Steps:",
    "1. Review the issue details provided in the prompt.",
    "2. If you need more details, use the fetch-issue tool.",
    "3. Use the spawn-worker tool to create a Docker container that will implement the issue.",
    "4. Pass the issue ID, identifier, title, a clear description of what to implement, and the branch name.",
    "Always spawn exactly one worker per issue.",
  ],
  model: createModel(),
  tools: { fetchIssueTool, spawnWorkerTool },
});
