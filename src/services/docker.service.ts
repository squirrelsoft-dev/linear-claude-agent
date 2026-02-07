import Dockerode from "dockerode";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

export interface SpawnWorkerOptions {
  issueId: string;
  identifier: string;
  title: string;
  description: string;
  branch: string;
}

export async function spawnWorkerContainer(
  opts: SpawnWorkerOptions,
): Promise<{ containerId: string }> {
  const containerName = `worker-${opts.identifier.toLowerCase()}-${Date.now()}`;

  logger.info(
    { containerName, image: config.WORKER_IMAGE, branch: opts.branch },
    "Spawning worker container",
  );

  const container = await docker.createContainer({
    Image: config.WORKER_IMAGE,
    name: containerName,
    Env: [
      `ISSUE_ID=${opts.issueId}`,
      `ISSUE_IDENTIFIER=${opts.identifier}`,
      `ISSUE_TITLE=${opts.title}`,
      `ISSUE_DESCRIPTION=${opts.description}`,
      `BRANCH=${opts.branch}`,
      `REPO_URL=${config.REPO_URL}`,
      `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}`,
      `LINEAR_API_KEY=${config.LINEAR_API_KEY}`,
      `CALLBACK_URL=${config.CALLBACK_BASE_URL}/api/worker/complete`,
      `WORKER_TIMEOUT=${config.WORKER_TIMEOUT}`,
      `WORKER_MAX_TURNS=${config.WORKER_MAX_TURNS}`,
    ],
    HostConfig: {
      NetworkMode: config.WORKER_NETWORK,
      Binds: [`${config.HOST_SSH_PATH}:/root/.ssh:ro`],
      AutoRemove: true,
    },
  });

  await container.start();

  logger.info(
    { containerId: container.id, containerName },
    "Worker container started",
  );

  return { containerId: container.id };
}
