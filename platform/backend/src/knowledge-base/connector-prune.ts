import type pino from "pino";
import defaultLogger from "@/logging";
import {
  ConnectorRunModel,
  KbDocumentModel,
  KnowledgeBaseConnectorModel,
} from "@/models";
import type { PruneCheckpoint } from "@/types";
import { loadConnectorCredentials } from "./connector-credentials";
import {
  BaseConnector,
  extractErrorMessage,
} from "./connectors/base-connector";
import { getConnector } from "./connectors/registry";

class ConnectorPruneService {
  async executePrune(
    connectorId: string,
    options?: {
      logger?: pino.Logger;
      getLogOutput?: () => string;
      maxDurationMs?: number;
    },
  ): Promise<{ runId: string; status: string }> {
    const log = options?.logger ?? defaultLogger;

    const connector = await KnowledgeBaseConnectorModel.findById(connectorId);
    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    const credentials = await loadConnectorCredentials(connector.secretId, log);
    const connectorImpl = getConnector(connector.connectorType);

    const interrupted =
      await ConnectorRunModel.interruptActiveRuns(connectorId);
    if (interrupted > 0) {
      log.info(
        {
          connectorId,
          connectorName: connector.name,
          connectorType: connector.connectorType,
          interrupted,
        },
        "Interrupted stale running runs",
      );
    }

    const partialRun = await ConnectorRunModel.findPartialByConnector(
      connectorId,
      "prune",
    );

    let run: Awaited<ReturnType<typeof ConnectorRunModel.create>>;
    let cursor: string | undefined;
    let seenIds: string[];

    if (partialRun) {
      await Promise.all([
        await ConnectorRunModel.update(partialRun.id, { status: "running" }),
        await KnowledgeBaseConnectorModel.update(connectorId, {
          lastPruneStatus: "running",
          lastPruneError: null,
        }),
      ]);
      run = partialRun;
      const checkpoint = (partialRun.checkpoint ?? {}) as PruneCheckpoint;
      cursor = checkpoint.cursor;
      seenIds = checkpoint.seenIds ?? [];
      log.info(
        {
          connectorId,
          runId: run.id,
          seenCount: seenIds.length,
        },
        "Resuming partial prune run",
      );
    } else {
      [run] = await Promise.all([
        await ConnectorRunModel.create({
          connectorId,
          type: "prune",
          status: "running",
          startedAt: new Date(),
        }),
        await KnowledgeBaseConnectorModel.update(connectorId, {
          lastPruneStatus: "running",
          lastPruneError: null,
        }),
      ]);
      cursor = undefined;
      seenIds = [];
    }

    const runLog = log.child({
      runId: run.id,
      connectorId,
      connectorName: connector.name,
      connectorType: connector.connectorType,
    });

    if (connectorImpl instanceof BaseConnector) {
      connectorImpl.setLogger(runLog);
    }

    const createdBefore = run.startedAt;
    const startTime = Date.now();
    let documentsPruned = run.documentsPruned ?? 0;

    try {
      const generator = connectorImpl.listAllSourceIds?.({
        config: connector.config as Record<string, unknown>,
        credentials,
        cursor,
      });

      for await (const batch of generator ?? []) {
        seenIds.push(...batch.sourceIds);

        await ConnectorRunModel.update(run.id, {
          checkpoint: {
            cursor: batch.cursor,
            seenIds,
          },
        });

        if (options?.maxDurationMs && batch.hasMore) {
          const elapsed = Date.now() - startTime;
          if (elapsed > options.maxDurationMs * 0.9) {
            await ConnectorRunModel.update(run.id, {
              status: "partial",
              completedAt: new Date(),
              documentsPruned,
              logs: options.getLogOutput?.() ?? null,
            });
            await KnowledgeBaseConnectorModel.update(connectorId, {
              lastPruneAt: new Date(),
              lastPruneStatus: "partial",
            });
            runLog.info(
              { elapsedMs: elapsed, seenCount: seenIds.length },
              "Time budget exceeded, stopping prune early for continuation",
            );
            return { runId: run.id, status: "partial" };
          }
        }

        cursor = batch.cursor;
      }

      // Full enumeration complete — safe to delete orphans
      if (seenIds.length > 0) {
        const pruned = await KbDocumentModel.deleteOrphaned({
          connectorId,
          seenSourceIds: seenIds,
          createdBefore,
        });
        documentsPruned += pruned;
        runLog.info(
          { pruned, seenCount: seenIds.length },
          "Orphan prune completed",
        );
      }

      await ConnectorRunModel.update(run.id, {
        status: "success",
        completedAt: new Date(),
        documentsPruned,
        logs: options?.getLogOutput?.() ?? null,
      });
      await KnowledgeBaseConnectorModel.update(connectorId, {
        lastPruneAt: new Date(),
        lastPruneStatus: "success",
        lastPruneError: null,
      });

      runLog.info({ documentsPruned }, "Prune completed successfully");
      return { runId: run.id, status: "success" };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      await ConnectorRunModel.update(run.id, {
        status: "failed",
        completedAt: new Date(),
        error: errorMessage,
        logs: options?.getLogOutput?.() ?? null,
      });
      await KnowledgeBaseConnectorModel.update(connectorId, {
        lastPruneAt: new Date(),
        lastPruneStatus: "failed",
        lastPruneError: errorMessage,
      });
      runLog.error({ error: errorMessage }, "Prune failed");
      return { runId: run.id, status: "failed" };
    }
  }
}

export const connectorPruneService = new ConnectorPruneService();
