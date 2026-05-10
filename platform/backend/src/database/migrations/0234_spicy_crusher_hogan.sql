ALTER TABLE "connector_runs" ADD COLUMN "type" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD COLUMN "documents_pruned" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "knowledge_base_connectors" ADD COLUMN "last_prune_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_base_connectors" ADD COLUMN "last_prune_status" text;--> statement-breakpoint
ALTER TABLE "knowledge_base_connectors" ADD COLUMN "last_prune_error" text;