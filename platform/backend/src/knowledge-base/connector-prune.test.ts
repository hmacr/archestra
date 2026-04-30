import { vi } from "vitest";

const mockGetConnector = vi.hoisted(() => vi.fn());
vi.mock("./connectors/registry", () => ({
  getConnector: mockGetConnector,
}));

const mockGetSecret = vi.hoisted(() => vi.fn());
vi.mock("@/secrets-manager", () => ({
  secretManager: () => ({
    getSecret: mockGetSecret,
  }),
}));

import db, { schema } from "@/database";
import {
  ConnectorRunModel,
  KbDocumentModel,
  KnowledgeBaseConnectorModel,
} from "@/models";
import { describe, expect, test } from "@/test";
import { connectorPruneService } from "./connector-prune";

async function createSecret(): Promise<string> {
  const [secret] = await db
    .insert(schema.secretsTable)
    .values({ secret: { email: "user@test.com", apiToken: "tok-123" } })
    .returning();
  return secret.id;
}

function setupSecret() {
  mockGetSecret.mockResolvedValue({
    id: "secret-1",
    secret: { email: "user@test.com", apiToken: "tok-123" },
  });
}

async function insertDocumentAt(
  connectorId: string,
  organizationId: string,
  sourceId: string,
  createdAt: Date,
) {
  const id = crypto.randomUUID().substring(0, 8);
  const [result] = await db
    .insert(schema.kbDocumentsTable)
    .values({
      connectorId,
      organizationId,
      sourceId,
      title: `Doc ${id}`,
      content: `Content ${id}`,
      contentHash: `hash-${id}`,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  return result;
}

function makeNoOpConnector() {
  return {
    estimateTotalItems: vi.fn().mockResolvedValue(null),
    sync: vi.fn().mockImplementation(() => (async function* () {})()),
    listAllSourceIds: vi
      .fn()
      .mockImplementation(() => (async function* () {})()),
  };
}

function makeConnectorWithSourceIds(
  batches: Array<{ sourceIds: string[]; cursor?: string; hasMore: boolean }>,
) {
  return {
    estimateTotalItems: vi.fn().mockResolvedValue(null),
    sync: vi.fn().mockImplementation(() => (async function* () {})()),
    listAllSourceIds: vi.fn().mockImplementation(() =>
      (async function* () {
        for (const batch of batches) {
          yield batch;
        }
      })(),
    ),
  };
}

describe("ConnectorPruneService", () => {
  test("throws when connector not found", async () => {
    await expect(
      connectorPruneService.executePrune(
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow("Connector not found");
  });

  test("deleteOrphaned called on fetching all documents", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    const mockImpl = makeConnectorWithSourceIds([
      { sourceIds: ["alive"], cursor: undefined, hasMore: false },
    ]);
    mockGetConnector.mockReturnValue(mockImpl);

    const createdAt = new Date(Date.now() - 10_000);
    const orphan = await insertDocumentAt(
      connector.id,
      org.id,
      "orphan",
      createdAt,
    );
    const alive = await insertDocumentAt(
      connector.id,
      org.id,
      "alive",
      createdAt,
    );

    const result = await connectorPruneService.executePrune(connector.id);

    expect(result.status).toBe("success");
    expect(await KbDocumentModel.findById(orphan.id)).toBeNull();
    expect(await KbDocumentModel.findById(alive.id)).not.toBeNull();
  });

  test("resume from partial run: uses saved checkpoint seenIds and cursor", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    // Connector will yield "alive2" on resume
    const mockImpl = makeConnectorWithSourceIds([
      { sourceIds: ["alive2"], cursor: undefined, hasMore: false },
    ]);
    mockGetConnector.mockReturnValue(mockImpl);

    // Partial run already has "alive1" in seenIds from a previous execution
    const partialRun = await ConnectorRunModel.create({
      connectorId: connector.id,
      type: "prune",
      status: "partial",
      startedAt: new Date(Date.now() - 10_000),
      checkpoint: {
        type: "jira",
        cursor: "page-2",
        seenIds: ["alive1"],
      },
    });

    const createdAt = new Date(partialRun.startedAt.getTime() - 5_000);
    const orphan = await insertDocumentAt(
      connector.id,
      org.id,
      "orphan",
      createdAt,
    );
    const alive1 = await insertDocumentAt(
      connector.id,
      org.id,
      "alive1",
      createdAt,
    );
    const alive2 = await insertDocumentAt(
      connector.id,
      org.id,
      "alive2",
      createdAt,
    );

    const result = await connectorPruneService.executePrune(connector.id);

    expect(result.status).toBe("success");
    expect(await KbDocumentModel.findById(orphan.id)).toBeNull();
    expect(await KbDocumentModel.findById(alive1.id)).not.toBeNull();
    expect(await KbDocumentModel.findById(alive2.id)).not.toBeNull();
  });

  test("lastPruneAt is updated on partial outcome", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    const mockImpl = makeConnectorWithSourceIds([
      { sourceIds: ["id-1"], cursor: "cursor-2", hasMore: true },
    ]);
    mockGetConnector.mockReturnValue(mockImpl);

    const result = await connectorPruneService.executePrune(connector.id, {
      maxDurationMs: 1, // Very short so it times out immediately
    });

    expect(result.status).toBe("partial");
    const updated = await KnowledgeBaseConnectorModel.findById(connector.id);
    expect(updated?.lastPruneAt).toBeInstanceOf(Date);
  });

  test("lastPruneAt is updated on success outcome", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    mockGetConnector.mockReturnValue(makeNoOpConnector());

    const before = new Date();
    await connectorPruneService.executePrune(connector.id);

    const updated = await KnowledgeBaseConnectorModel.findById(connector.id);
    expect(updated?.lastPruneAt).toBeInstanceOf(Date);
    expect(updated?.lastPruneAt?.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  test("lastPruneAt is updated on failed outcome", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    const badConnector = {
      estimateTotalItems: vi.fn().mockResolvedValue(null),
      sync: vi.fn().mockImplementation(() => (async function* () {})()),
      listAllSourceIds: vi.fn().mockImplementation(() => {
        throw new Error("Enumeration failed");
      }),
    };
    mockGetConnector.mockReturnValue(badConnector);

    const result = await connectorPruneService.executePrune(connector.id);

    expect(result.status).toBe("failed");
    const updated = await KnowledgeBaseConnectorModel.findById(connector.id);
    expect(updated?.lastPruneAt).toBeInstanceOf(Date);
  });

  test("empty seenIds guard: if listAllSourceIds yields only empty batches, deleteOrphaned is not called", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    const mockImpl = makeConnectorWithSourceIds([
      { sourceIds: [], cursor: undefined, hasMore: false },
    ]);
    mockGetConnector.mockReturnValue(mockImpl);

    const createdAt = new Date(Date.now() - 5_000);
    const doc = await insertDocumentAt(
      connector.id,
      org.id,
      "safe-doc",
      createdAt,
    );

    const result = await connectorPruneService.executePrune(connector.id);

    expect(result.status).toBe("success");
    // Doc should NOT be deleted because seenIds was empty (safety guard)
    expect(await KbDocumentModel.findById(doc.id)).not.toBeNull();
  });

  test("stale running prune run is interrupted at start of new executePrune call", async ({
    makeOrganization,
    makeKnowledgeBase,
    makeKnowledgeBaseConnector,
  }) => {
    const org = await makeOrganization();
    const kb = await makeKnowledgeBase(org.id);
    const secretId = await createSecret();
    const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
    await KnowledgeBaseConnectorModel.update(connector.id, { secretId });

    setupSecret();
    mockGetConnector.mockReturnValue(makeNoOpConnector());

    // Pre-create a stale "running" prune run
    const staleRun = await ConnectorRunModel.create({
      connectorId: connector.id,
      type: "prune",
      status: "running",
      startedAt: new Date(Date.now() - 60_000),
    });

    await connectorPruneService.executePrune(connector.id);

    const afterStale = await ConnectorRunModel.findById(staleRun.id);
    expect(afterStale?.status).toBe("failed");
    expect(afterStale?.error).toBe("Superseded by a new run");
  });
});
