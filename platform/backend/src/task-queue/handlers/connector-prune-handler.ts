import config from "@/config";
import { createCapturingLogger } from "@/entrypoints/_shared/log-capture";
import { connectorPruneService } from "@/knowledge-base";
import logger from "@/logging";
import { KnowledgeBaseConnectorModel } from "@/models";
import { taskQueueService } from "@/task-queue";

const MAX_CONTINUATIONS = 50;

export async function handleConnectorPrune(
  payload: Record<string, unknown>,
): Promise<void> {
  const connectorId = payload.connectorId as string;
  const continuationCount = (payload.continuationCount as number) ?? 0;

  if (!connectorId) {
    throw new Error("Missing connectorId in connector_prune payload");
  }

  const connector = await KnowledgeBaseConnectorModel.findById(connectorId);
  const connectorName = connector?.name;
  const connectorType = connector?.connectorType;

  const { logger: capturingLogger, getLogOutput } = createCapturingLogger();

  const maxDurationMs = config.kb.connectorSyncMaxDurationSeconds
    ? config.kb.connectorSyncMaxDurationSeconds * 1000
    : undefined;

  const result = await connectorPruneService.executePrune(connectorId, {
    logger: capturingLogger,
    getLogOutput,
    maxDurationMs,
  });

  if (result.status === "partial") {
    if (continuationCount < MAX_CONTINUATIONS) {
      await taskQueueService.enqueue({
        taskType: "connector_prune",
        payload: { connectorId, continuationCount: continuationCount + 1 },
      });
      logger.info(
        {
          connectorId,
          connectorName,
          connectorType,
          continuationCount: continuationCount + 1,
        },
        "Enqueued prune continuation",
      );
    } else {
      logger.warn(
        {
          connectorId,
          connectorName,
          connectorType,
          maxContinuations: MAX_CONTINUATIONS,
        },
        "Max prune continuations reached",
      );
    }
  }
}
