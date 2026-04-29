import db, { schema } from "@/database";
import { describe, expect, test } from "@/test";
import type { InsertKbDocument, KbDocument } from "@/types";
import KbDocumentModel from "./kb-document";

async function insertDocumentAt(
  connectorId: string,
  organizationId: string,
  sourceId: string,
  createdAt: Date,
): Promise<KbDocument> {
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

function createDocumentData(
  connectorId: string,
  organizationId: string,
  overrides: Partial<InsertKbDocument> = {},
): InsertKbDocument {
  const id = crypto.randomUUID().substring(0, 8);
  return {
    connectorId,
    organizationId,
    title: `Test Document ${id}`,
    content: `Content for document ${id}`,
    contentHash: `hash-${id}`,
    ...overrides,
  };
}

describe("KbDocumentModel", () => {
  describe("create", () => {
    test("creates a document with required fields", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);

      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, {
          title: "My Document",
          content: "Document content here",
          contentHash: "abc123",
        }),
      );

      expect(doc.id).toBeDefined();
      expect(doc.connectorId).toBe(connector.id);
      expect(doc.organizationId).toBe(org.id);
      expect(doc.title).toBe("My Document");
      expect(doc.content).toBe("Document content here");
      expect(doc.contentHash).toBe("abc123");
      expect(doc.embeddingStatus).toBe("pending");
      expect(doc.chunkCount).toBe(0);
      expect(doc.acl).toEqual([]);
      expect(doc.sourceId).toBeNull();
      expect(doc.sourceUrl).toBeNull();
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    test("creates a document with optional fields", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);

      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, {
          sourceId: "JIRA-123",
          sourceUrl: "https://jira.example.com/JIRA-123",
          acl: ["team-a", "team-b"],
          metadata: { priority: "high" },
          embeddingStatus: "completed",
          chunkCount: 5,
        }),
      );

      expect(doc.sourceId).toBe("JIRA-123");
      expect(doc.sourceUrl).toBe("https://jira.example.com/JIRA-123");
      expect(doc.acl).toEqual(["team-a", "team-b"]);
      expect(doc.metadata).toEqual({ priority: "high" });
      expect(doc.embeddingStatus).toBe("completed");
      expect(doc.chunkCount).toBe(5);
    });
  });

  describe("findById", () => {
    test("returns a document by id", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, { title: "Find Me" }),
      );

      const found = await KbDocumentModel.findById(doc.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(doc.id);
      expect(found?.title).toBe("Find Me");
    });

    test("returns null for non-existent id", async () => {
      const found = await KbDocumentModel.findById(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(found).toBeNull();
    });
  });

  describe("findByKnowledgeBase", () => {
    test("returns documents for a knowledge base via connector assignment", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));

      const results = await KbDocumentModel.findByKnowledgeBase({
        knowledgeBaseId: kb.id,
      });

      expect(results).toHaveLength(2);
    });

    test("does not return documents from other knowledge bases", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb1 = await makeKnowledgeBase(org.id);
      const kb2 = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb1.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb2.id, org.id);
      await KbDocumentModel.create(
        createDocumentData(connector1.id, org.id, { title: "KB1 Doc" }),
      );
      await KbDocumentModel.create(
        createDocumentData(connector2.id, org.id, { title: "KB2 Doc" }),
      );

      const results = await KbDocumentModel.findByKnowledgeBase({
        knowledgeBaseId: kb1.id,
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("KB1 Doc");
    });

    test("supports limit parameter", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));

      const results = await KbDocumentModel.findByKnowledgeBase({
        knowledgeBaseId: kb.id,
        limit: 2,
      });

      expect(results).toHaveLength(2);
    });

    test("supports offset parameter", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));

      const results = await KbDocumentModel.findByKnowledgeBase({
        knowledgeBaseId: kb.id,
        limit: 2,
        offset: 1,
      });

      expect(results).toHaveLength(2);
    });

    test("returns empty array when no documents exist", async ({
      makeOrganization,
      makeKnowledgeBase,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);

      const results = await KbDocumentModel.findByKnowledgeBase({
        knowledgeBaseId: kb.id,
      });

      expect(results).toEqual([]);
    });
  });

  describe("findBySourceId", () => {
    test("returns a document matching connector and source id", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, {
          sourceId: "JIRA-456",
          title: "Jira Issue",
        }),
      );

      const found = await KbDocumentModel.findBySourceId({
        connectorId: connector.id,
        sourceId: "JIRA-456",
      });

      expect(found).not.toBeNull();
      expect(found?.title).toBe("Jira Issue");
      expect(found?.sourceId).toBe("JIRA-456");
    });

    test("returns null when source id does not match", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, {
          sourceId: "JIRA-100",
        }),
      );

      const found = await KbDocumentModel.findBySourceId({
        connectorId: connector.id,
        sourceId: "JIRA-999",
      });

      expect(found).toBeNull();
    });

    test("scopes source id lookup to the connector", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb1 = await makeKnowledgeBase(org.id);
      const kb2 = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb1.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb2.id, org.id);
      await KbDocumentModel.create(
        createDocumentData(connector1.id, org.id, {
          sourceId: "SHARED-ID",
        }),
      );

      const found = await KbDocumentModel.findBySourceId({
        connectorId: connector2.id,
        sourceId: "SHARED-ID",
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    test("updates a document title", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id, { title: "Original Title" }),
      );

      const updated = await KbDocumentModel.update(doc.id, {
        title: "Updated Title",
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("Updated Title");
      expect(updated?.content).toBe(doc.content);
    });

    test("updates embedding status", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id),
      );

      const updated = await KbDocumentModel.update(doc.id, {
        embeddingStatus: "completed",
        chunkCount: 10,
      });

      expect(updated?.embeddingStatus).toBe("completed");
      expect(updated?.chunkCount).toBe(10);
    });

    test("returns null for non-existent id", async () => {
      const updated = await KbDocumentModel.update(
        "00000000-0000-0000-0000-000000000000",
        { title: "Nope" },
      );
      expect(updated).toBeNull();
    });
  });

  describe("delete", () => {
    test("deletes a document", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const doc = await KbDocumentModel.create(
        createDocumentData(connector.id, org.id),
      );

      await KbDocumentModel.delete(doc.id);

      // Verify record is actually gone (PGlite may not return accurate rowCount)
      const found = await KbDocumentModel.findById(doc.id);
      expect(found).toBeNull();
    });

    test("returns false for non-existent id", async () => {
      const deleted = await KbDocumentModel.delete(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(deleted).toBe(false);
    });
  });

  describe("deleteByConnector", () => {
    test("deletes all documents for a connector", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));

      await KbDocumentModel.deleteByConnector(connector.id);

      const count = await KbDocumentModel.countByConnector(connector.id);
      expect(count).toBe(0);
    });

    test("does not delete documents from other connectors", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector1.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector2.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector2.id, org.id));

      await KbDocumentModel.deleteByConnector(connector1.id);

      const count1 = await KbDocumentModel.countByConnector(connector1.id);
      const count2 = await KbDocumentModel.countByConnector(connector2.id);
      expect(count1).toBe(0);
      expect(count2).toBe(2);
    });

    test("returns 0 when connector has no documents", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);

      const count = await KbDocumentModel.deleteByConnector(connector.id);

      // PGlite may return 0
      expect(count).toBe(0);
    });
  });

  describe("countByKnowledgeBase", () => {
    test("returns the count of documents in a knowledge base", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector.id, org.id));

      const count = await KbDocumentModel.countByKnowledgeBase(kb.id);
      expect(count).toBe(2);
    });

    test("returns 0 when no documents exist", async ({
      makeOrganization,
      makeKnowledgeBase,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);

      const count = await KbDocumentModel.countByKnowledgeBase(kb.id);
      expect(count).toBe(0);
    });

    test("does not count documents from other knowledge bases", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb1 = await makeKnowledgeBase(org.id);
      const kb2 = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb1.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb2.id, org.id);
      await KbDocumentModel.create(createDocumentData(connector1.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector1.id, org.id));
      await KbDocumentModel.create(createDocumentData(connector2.id, org.id));

      const count = await KbDocumentModel.countByKnowledgeBase(kb1.id);
      expect(count).toBe(2);
    });
  });

  describe("updateAclByConnector", () => {
    test("updates only documents whose ACL differs from the target ACL", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const targetConnector = await makeKnowledgeBaseConnector(kb.id, org.id, {
        name: "Target Connector",
      });
      const otherConnector = await makeKnowledgeBaseConnector(kb.id, org.id, {
        name: "Other Connector",
      });

      const unchangedDoc = await KbDocumentModel.create(
        createDocumentData(targetConnector.id, org.id, {
          acl: ["team:alpha"],
        }),
      );
      const changedDoc = await KbDocumentModel.create(
        createDocumentData(targetConnector.id, org.id, {
          acl: ["org:*"],
        }),
      );
      const otherDoc = await KbDocumentModel.create(
        createDocumentData(otherConnector.id, org.id, {
          acl: ["org:*"],
        }),
      );

      const updatedCount = await KbDocumentModel.updateAclByConnector(
        targetConnector.id,
        ["team:alpha"],
      );

      expect(updatedCount).toBe(1);
      expect((await KbDocumentModel.findById(unchangedDoc.id))?.acl).toEqual([
        "team:alpha",
      ]);
      expect((await KbDocumentModel.findById(changedDoc.id))?.acl).toEqual([
        "team:alpha",
      ]);
      expect((await KbDocumentModel.findById(otherDoc.id))?.acl).toEqual([
        "org:*",
      ]);
    });
  });

  describe("deleteCreatedBefore", () => {
    test("deletes documents with createdAt before the cutoff", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const cutoff = new Date("2024-06-01T00:00:00Z");

      const oldDoc = await insertDocumentAt(
        connector.id, org.id, "old-doc", new Date("2024-01-01T00:00:00Z"),
      );
      const newDoc = await insertDocumentAt(
        connector.id, org.id, "new-doc", new Date("2024-12-01T00:00:00Z"),
      );

      const deleted = await KbDocumentModel.deleteCreatedBefore({
        connectorId: connector.id,
        before: cutoff,
      });

      expect(deleted).toBe(1);
      expect(await KbDocumentModel.findById(oldDoc.id)).toBeNull();
      expect(await KbDocumentModel.findById(newDoc.id)).not.toBeNull();
    });

    test("spares documents with createdAt equal to or after the cutoff", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const cutoff = new Date("2024-06-01T00:00:00Z");

      const onCutoff = await insertDocumentAt(
        connector.id, org.id, "on-cutoff", cutoff,
      );

      const deleted = await KbDocumentModel.deleteCreatedBefore({
        connectorId: connector.id,
        before: cutoff,
      });

      expect(deleted).toBe(0);
      expect(await KbDocumentModel.findById(onCutoff.id)).not.toBeNull();
    });

    test("only affects documents for the given connectorId", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb.id, org.id);
      const cutoff = new Date("2024-06-01T00:00:00Z");

      const doc1 = await insertDocumentAt(
        connector1.id, org.id, "doc-c1", new Date("2024-01-01T00:00:00Z"),
      );
      const doc2 = await insertDocumentAt(
        connector2.id, org.id, "doc-c2", new Date("2024-01-01T00:00:00Z"),
      );

      await KbDocumentModel.deleteCreatedBefore({
        connectorId: connector1.id,
        before: cutoff,
      });

      expect(await KbDocumentModel.findById(doc1.id)).toBeNull();
      expect(await KbDocumentModel.findById(doc2.id)).not.toBeNull();
    });
  });

  describe("deleteOrphaned", () => {
    test("deletes documents whose sourceId is not in seenSourceIds", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const runStart = new Date("2024-12-01T00:00:00Z");

      const orphan = await insertDocumentAt(
        connector.id, org.id, "orphan", new Date("2024-06-01T00:00:00Z"),
      );
      const alive = await insertDocumentAt(
        connector.id, org.id, "alive", new Date("2024-06-01T00:00:00Z"),
      );

      const deleted = await KbDocumentModel.deleteOrphaned({
        connectorId: connector.id,
        seenSourceIds: ["alive"],
        createdBefore: runStart,
      });

      expect(deleted).toBe(1);
      expect(await KbDocumentModel.findById(orphan.id)).toBeNull();
      expect(await KbDocumentModel.findById(alive.id)).not.toBeNull();
    });

    test("spares documents whose sourceId is in seenSourceIds", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const runStart = new Date("2024-12-01T00:00:00Z");

      const doc = await insertDocumentAt(
        connector.id, org.id, "kept", new Date("2024-06-01T00:00:00Z"),
      );

      const deleted = await KbDocumentModel.deleteOrphaned({
        connectorId: connector.id,
        seenSourceIds: ["kept"],
        createdBefore: runStart,
      });

      expect(deleted).toBe(0);
      expect(await KbDocumentModel.findById(doc.id)).not.toBeNull();
    });

    test("respects createdBefore guard — spares docs created after run start", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const runStart = new Date("2024-06-01T00:00:00Z");

      // Created after run start — should be spared even though not in seenIds
      const concurrentDoc = await insertDocumentAt(
        connector.id, org.id, "concurrent", new Date("2024-12-01T00:00:00Z"),
      );

      const deleted = await KbDocumentModel.deleteOrphaned({
        connectorId: connector.id,
        seenSourceIds: ["something-else"],
        createdBefore: runStart,
      });

      expect(deleted).toBe(0);
      expect(await KbDocumentModel.findById(concurrentDoc.id)).not.toBeNull();
    });

    test("empty seenSourceIds is a complete no-op — returns 0 and deletes nothing", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector = await makeKnowledgeBaseConnector(kb.id, org.id);
      const runStart = new Date("2024-12-01T00:00:00Z");

      const doc = await insertDocumentAt(
        connector.id, org.id, "safe", new Date("2024-06-01T00:00:00Z"),
      );

      const deleted = await KbDocumentModel.deleteOrphaned({
        connectorId: connector.id,
        seenSourceIds: [],
        createdBefore: runStart,
      });

      expect(deleted).toBe(0);
      expect(await KbDocumentModel.findById(doc.id)).not.toBeNull();
    });

    test("only affects documents for the given connectorId", async ({
      makeOrganization,
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const org = await makeOrganization();
      const kb = await makeKnowledgeBase(org.id);
      const connector1 = await makeKnowledgeBaseConnector(kb.id, org.id);
      const connector2 = await makeKnowledgeBaseConnector(kb.id, org.id);
      const runStart = new Date("2024-12-01T00:00:00Z");

      const doc1 = await insertDocumentAt(
        connector1.id, org.id, "orphan-c1", new Date("2024-01-01T00:00:00Z"),
      );
      const doc2 = await insertDocumentAt(
        connector2.id, org.id, "orphan-c2", new Date("2024-01-01T00:00:00Z"),
      );

      await KbDocumentModel.deleteOrphaned({
        connectorId: connector1.id,
        seenSourceIds: ["other-doc"],
        createdBefore: runStart,
      });

      expect(await KbDocumentModel.findById(doc1.id)).toBeNull();
      expect(await KbDocumentModel.findById(doc2.id)).not.toBeNull();
    });
  });
});
