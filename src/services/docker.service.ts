import Dockerode from "dockerode";
import { logger } from "../utils/logger.js";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

export interface SpawnWorkerOptions {
  issueId: string;
  identifier: string;
  title: string;
  taskDescription: string;
  branchName: string;
  baseBranch: string;
  repoUrl: string;
  callbackUrl: string;
  agentKey: string;
  anthropicApiKey: string;
  linearApiKey: string;
  workerTimeout: number;
  workerMaxTurns: number;
  workerNetwork: string;
  workerImage: string;
  hostSshPath: string;
  hostClaudeAuthPath: string;
}

export async function ensureNetwork(networkName: string): Promise<void> {
  try {
    const network = docker.getNetwork(networkName);
    await network.inspect();
    logger.info({ network: networkName }, "Docker network already exists");
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      await docker.createNetwork({ Name: networkName, Driver: "bridge" });
      logger.info({ network: networkName }, "Docker network created");
    } else {
      throw err;
    }
  }
}

export async function stopContainer(
  container: Dockerode.Container,
): Promise<void> {
  try {
    await container.stop();
    logger.info({ containerId: container.id }, "Container stopped");
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 304 || statusCode === 404) {
      logger.debug(
        { containerId: container.id, statusCode },
        "Container already stopped or removed",
      );
    } else {
      throw err;
    }
  }
}

export async function spawnWorkerContainer(
  opts: SpawnWorkerOptions,
): Promise<Dockerode.Container> {
  const containerName = `worker-${opts.identifier.toLowerCase()}-${Date.now()}`;

  logger.info(
    {
      containerName,
      image: opts.workerImage,
      branch: opts.branchName,
    },
    "Spawning worker container",
  );

  const container = await docker.createContainer({
    Image: opts.workerImage,
    name: containerName,
    Env: [
      `ISSUE_ID=${opts.issueId}`,
      `LINEAR_ISSUE_ID=${opts.issueId}`,
      `ISSUE_IDENTIFIER=${opts.identifier}`,
      `ISSUE_TITLE=${opts.title}`,
      `TASK_DESCRIPTION=${opts.taskDescription}`,
      `BRANCH_NAME=${opts.branchName}`,
      `BASE_BRANCH=${opts.baseBranch}`,
      `REPO_URL=${opts.repoUrl}`,
      `ANTHROPIC_API_KEY=${opts.anthropicApiKey}`,
      `LINEAR_API_KEY=${opts.linearApiKey}`,
      `CALLBACK_URL=${opts.callbackUrl}`,
      `AGENT_KEY=${opts.agentKey}`,
      `WORKER_TIMEOUT=${opts.workerTimeout}`,
      `WORKER_MAX_TURNS=${opts.workerMaxTurns}`,
    ],
    HostConfig: {
      NetworkMode: opts.workerNetwork,
      Binds: [
        `${opts.hostSshPath}:/root/.ssh:ro`,
        `${opts.hostClaudeAuthPath}:/root/.claude:ro`,
      ],
      AutoRemove: true,
    },
  });

  await container.start();

  logger.info(
    { containerId: container.id, containerName },
    "Worker container started",
  );

  return container;
}
