import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { beforeEach, describe, expect, test } from "@/test";

const mockExecutePrune = vi.hoisted(() => vi.fn());
vi.mock("@/knowledge-base", () => ({
  connectorPruneService: { executePrune: mockExecutePrune },
}));

const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue("task-id"));
vi.mock("@/task-queue", () => ({
  taskQueueService: { enqueue: mockEnqueue },
}));

const mockFindById = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ name: "Test Connector", connectorType: "jira" }),
);
vi.mock("@/models", () => ({
  KnowledgeBaseConnectorModel: { findById: mockFindById },
}));

vi.mock("@/entrypoints/_shared/log-capture", () => ({
  createCapturingLogger: () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
      fatal: vi.fn(),
    },
    getLogOutput: () => "",
  }),
}));

vi.mock("@/logging", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { handleConnectorPrune } from "./connector-prune-handler";

describe("handleConnectorPrune", () => {
  let connectorId: string;

  beforeEach(() => {
    connectorId = randomUUID();
    vi.clearAllMocks();
  });

  test("calls executePrune with the correct connectorId", async () => {
    mockExecutePrune.mockResolvedValue({ runId: "run-1", status: "success" });

    await handleConnectorPrune({ connectorId });

    expect(mockExecutePrune).toHaveBeenCalledWith(
      connectorId,
      expect.objectContaining({
        logger: expect.any(Object),
        getLogOutput: expect.any(Function),
      }),
    );
  });

  test("does not enqueue continuation on success", async () => {
    mockExecutePrune.mockResolvedValue({ runId: "run-1", status: "success" });

    await handleConnectorPrune({ connectorId });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test("does not enqueue continuation on failed", async () => {
    mockExecutePrune.mockResolvedValue({ runId: "run-1", status: "failed" });

    await handleConnectorPrune({ connectorId });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test("enqueues continuation with incremented count on partial result", async () => {
    mockExecutePrune.mockResolvedValue({ runId: "run-1", status: "partial" });

    await handleConnectorPrune({ connectorId, continuationCount: 3 });

    expect(mockEnqueue).toHaveBeenCalledWith({
      taskType: "connector_prune",
      payload: {
        connectorId,
        continuationCount: 4,
      },
    });
  });

  test("does not enqueue when continuationCount reaches 50", async () => {
    mockExecutePrune.mockResolvedValue({ runId: "run-1", status: "partial" });

    await handleConnectorPrune({ connectorId, continuationCount: 50 });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test("throws when connectorId is missing", async () => {
    await expect(handleConnectorPrune({})).rejects.toThrow(
      "Missing connectorId in connector_prune payload",
    );
  });
});
