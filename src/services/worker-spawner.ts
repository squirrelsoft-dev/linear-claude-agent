import type Dockerode from "dockerode";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  ensureNetwork,
  spawnWorkerContainer,
  stopContainer,
} from "./docker.service.js";

export class WorkerAlreadyRunningError extends Error {
  constructor(issueId: string) {
    super(`Worker already running for issue ${issueId}`);
    this.name = "WorkerAlreadyRunningError";
  }
}

export class MaxConcurrencyError extends Error {
  constructor(max: number) {
    super(`Max concurrent workers reached (${max})`);
    this.name = "MaxConcurrencyError";
  }
}

interface TrackedWorker {
  containerId: string;
  branchName: string;
  container: Dockerode.Container;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface SpawnRequest {
  issueId: string;
  identifier: string;
  title: string;
  taskDescription: string;
}

function buildBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `ai/${identifier.toLowerCase()}-${slug}`;
}

class WorkerSpawner {
  private workers = new Map<string, TrackedWorker>();

  async initialize(): Promise<void> {
    await ensureNetwork(config.WORKER_NETWORK);
  }

  async spawn(
    request: SpawnRequest,
  ): Promise<{ containerId: string; branchName: string }> {
    if (this.workers.has(request.issueId)) {
      throw new WorkerAlreadyRunningError(request.issueId);
    }

    if (this.workers.size >= config.WORKER_MAX_CONCURRENT) {
      throw new MaxConcurrencyError(config.WORKER_MAX_CONCURRENT);
    }

    const branchName = buildBranchName(request.identifier, request.title);

    const container = await spawnWorkerContainer({
      issueId: request.issueId,
      identifier: request.identifier,
      title: request.title,
      taskDescription: request.taskDescription,
      branchName,
      baseBranch: config.BASE_BRANCH,
      repoUrl: config.REPO_URL,
      callbackUrl: `${config.CALLBACK_BASE_URL}/api/worker/complete`,
      agentKey: config.AGENT_KEY,
      anthropicApiKey: config.ANTHROPIC_API_KEY,
      linearApiKey: config.LINEAR_API_KEY,
      workerTimeout: config.WORKER_TIMEOUT,
      workerMaxTurns: config.WORKER_MAX_TURNS,
      workerNetwork: config.WORKER_NETWORK,
      workerImage: config.WORKER_IMAGE,
      hostSshPath: config.HOST_SSH_PATH,
      hostClaudeAuthPath: config.HOST_CLAUDE_AUTH_PATH,
    });

    const timeoutId = setTimeout(
      () => this.killTimedOutWorker(request.issueId),
      config.WORKER_TIMEOUT * 1000,
    );

    this.workers.set(request.issueId, {
      containerId: container.id,
      branchName,
      container,
      timeoutId,
    });

    logger.info(
      {
        issueId: request.issueId,
        containerId: container.id,
        branchName,
        activeWorkers: this.workers.size,
      },
      "Worker tracked",
    );

    return { containerId: container.id, branchName };
  }

  handleWorkerComplete(issueId: string): void {
    const tracked = this.workers.get(issueId);
    if (!tracked) {
      logger.debug({ issueId }, "No tracked worker for issue (already cleaned up)");
      return;
    }

    clearTimeout(tracked.timeoutId);
    this.workers.delete(issueId);

    logger.info(
      { issueId, containerId: tracked.containerId, activeWorkers: this.workers.size },
      "Worker tracking cleared",
    );
  }

  private async killTimedOutWorker(issueId: string): Promise<void> {
    const tracked = this.workers.get(issueId);
    if (!tracked) {
      logger.debug({ issueId }, "Timeout fired but worker already cleaned up");
      return;
    }

    logger.warn(
      { issueId, containerId: tracked.containerId },
      "Worker timed out, stopping container",
    );

    this.workers.delete(issueId);
    await stopContainer(tracked.container);
  }
}

export const workerSpawner = new WorkerSpawner();
