import { Mastra } from "@mastra/core/mastra";
import { pmAgent } from "./agents/pm-agent.js";

export const mastra = new Mastra({
  agents: { pmAgent },
});
