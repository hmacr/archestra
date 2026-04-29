import { Cron } from "croner";
import logger from "@/logging";
import {
  ConnectorRunModel,
  KnowledgeBaseConnectorModel,
  TaskModel,
} from "@/models";
import { taskQueueService } from "@/task-queue";
import type { KnowledgeBaseConnector } from "@/types";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

export async function handleCheckDueConnectors(): Promise<void> {
  const connectors = await KnowledgeBaseConnectorModel.findAllEnabled();

  for (const connector of connectors) {
    const hasScheduledPrune = await schedulePruneTask(connector);

    if (hasScheduledPrune || !connector.schedule) continue;

    try {
      const cron = new Cron(connector.schedule);
      const nextRun = cron.nextRun(connector.lastSyncAt ?? new Date(0));

      if (nextRun && nextRun <= new Date()) {
        const exists = await TaskModel.hasPendingOrProcessing(
          ["connector_sync", "connector_prune"],
          connector.id,
        );
        if (!exists) {
          await taskQueueService.enqueue({
            taskType: "connector_sync",
            payload: { connectorId: connector.id },
          });
          logger.info(
            {
              connectorId: connector.id,
              connectorName: connector.name,
              connectorType: connector.connectorType,
            },
            "Enqueued scheduled connector sync",
          );
        }
      }
    } catch (error) {
      logger.warn(
        {
          connectorId: connector.id,
          connectorName: connector.name,
          connectorType: connector.connectorType,
          schedule: connector.schedule,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to evaluate connector schedule",
      );
    }
  }

  await cleanupOrphanedRunningStatuses();
}

async function schedulePruneTask(
  connector: KnowledgeBaseConnector,
): Promise<boolean> {
  try {
    const lastPruneAt = connector.lastPruneAt ?? new Date(0);
    if (Date.now() - lastPruneAt.getTime() >= PRUNE_INTERVAL_MS) {
      const exists = await TaskModel.hasPendingOrProcessing(
        ["connector_sync", "connector_prune"],
        connector.id,
      );
      if (!exists) {
        await taskQueueService.enqueue({
          taskType: "connector_prune",
          payload: { connectorId: connector.id },
        });
        logger.info(
          {
            connectorId: connector.id,
            connectorName: connector.name,
          },
          "Enqueued scheduled connector prune",
        );
      }
      return true;
    }
  } catch (error) {
    logger.warn(
      {
        connectorId: connector.id,
        connectorName: connector.name,
        connectorType: connector.connectorType,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to evaluate connector prune schedule",
    );
  }
  return false;
}

async function cleanupOrphanedRunningStatuses(): Promise<void> {
  const stuckConnectors =
    await KnowledgeBaseConnectorModel.findAllWithStatus("running");

  for (const connector of stuckConnectors) {
    try {
      const hasPendingTask = await TaskModel.hasPendingOrProcessing(
        ["connector_sync", "connector_prune"],
        connector.id,
      );
      if (hasPendingTask) continue;

      const hasRun = await ConnectorRunModel.hasActiveRun(connector.id);
      if (hasRun) continue;

      await KnowledgeBaseConnectorModel.update(connector.id, {
        lastSyncStatus: "failed",
        lastSyncError: "Sync task was lost",
      });
      logger.warn(
        {
          connectorId: connector.id,
          connectorName: connector.name,
          connectorType: connector.connectorType,
        },
        "Reset orphaned running status to failed",
      );
    } catch (error) {
      logger.warn(
        {
          connectorId: connector.id,
          connectorName: connector.name,
          connectorType: connector.connectorType,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to cleanup orphaned running status",
      );
    }
  }
}
