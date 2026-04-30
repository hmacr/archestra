"use client";

import {
  ArrowLeft,
  Database,
  MoreHorizontal,
  Pencil,
  Play,
  Plug,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { ErrorBoundary } from "@/app/_parts/error-boundary";
import { ConnectorPruneRuns } from "@/app/knowledge/connectors/_parts/connector-prune-runs";
import { ConnectorRunDetailsDialog } from "@/app/knowledge/connectors/_parts/connector-run-details-dialog";
import { ConnectorSyncRuns } from "@/app/knowledge/connectors/_parts/connector-sync-runs";
import { ConnectorStatusDot } from "@/app/knowledge/knowledge-bases/_parts/connector-enabled-dot";
import { ConnectorTypeIcon } from "@/app/knowledge/knowledge-bases/_parts/connector-icons";
import { EditConnectorDialog } from "@/app/knowledge/knowledge-bases/_parts/edit-connector-dialog";
import { FormDialog } from "@/components/form-dialog";
import { LoadingSpinner } from "@/components/loading";
import { MetadataItem } from "@/components/metadata-card";
import { PageLayout } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogStickyFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAssignConnectorToKnowledgeBases,
  useConnector,
  useConnectorKnowledgeBases,
  useForceResyncConnector,
  useSyncConnector,
  useTestConnectorConnection,
  useUnassignConnectorFromKnowledgeBase,
} from "@/lib/knowledge/connector.query";
import { useKnowledgeBases } from "@/lib/knowledge/knowledge-base.query";
import { formatDate } from "@/lib/utils";
import { formatCronSchedule } from "@/lib/utils/format-cron";

export default function ConnectorDetailPage({
  connectorId,
}: {
  connectorId: string;
}) {
  return (
    <div className="w-full h-full">
      <ErrorBoundary>
        <ConnectorDetail connectorId={connectorId} />
      </ErrorBoundary>
    </div>
  );
}

function ConnectorDetail({ connectorId }: { connectorId: string }) {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const backHref =
    from === "knowledge-bases"
      ? "/knowledge/knowledge-bases"
      : "/knowledge/connectors";
  const backLabel =
    from === "knowledge-bases"
      ? "Back to Knowledge Bases"
      : "Back to Connectors";

  const { data: connector, isPending } = useConnector(connectorId);
  const syncConnector = useSyncConnector();
  const forceResync = useForceResyncConnector();
  const testConnection = useTestConnectorConnection();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isForceResyncOpen, setIsForceResyncOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<"sync" | "prune">("sync");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    await syncConnector.mutateAsync(connectorId);
  }, [syncConnector, connectorId]);

  const handleTestConnection = useCallback(async () => {
    await testConnection.mutateAsync(connectorId);
  }, [testConnection, connectorId]);

  if (isPending) {
    return <LoadingSpinner />;
  }

  if (!connector) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Connector not found.</p>
      </div>
    );
  }

  return (
    <PageLayout
      title={
        <div className="flex items-center gap-2.5">
          <ConnectorStatusDot
            enabled={connector.enabled}
            lastSyncStatus={connector.lastSyncStatus}
          />
          <div>
            <span>{connector.name}</span>
            {connector.description ? (
              <p className="text-sm font-normal text-muted-foreground mt-1 line-clamp-2 max-w-2xl">
                {connector.description.length > 300
                  ? `${connector.description.slice(0, 300)}…`
                  : connector.description}
              </p>
            ) : (
              <div>
                <Badge variant="secondary" className="gap-1.5 capitalize mt-1">
                  <ConnectorTypeIcon
                    type={connector.connectorType}
                    className="h-3.5 w-3.5"
                  />
                  {connector.connectorType}
                </Badge>
              </div>
            )}
          </div>
        </div>
      }
      description=""
      actionButton={
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={
                    syncConnector.isPending ||
                    connector.lastSyncStatus === "running"
                  }
                >
                  <Play className="mr-2 h-4 w-4" />
                  {syncConnector.isPending
                    ? "Starting..."
                    : connector.lastSyncStatus === "running"
                      ? "Syncing..."
                      : "Sync Now"}
                </Button>
              </span>
            </TooltipTrigger>
            {connector.lastSyncStatus === "running" && (
              <TooltipContent>Sync run in progress</TooltipContent>
            )}
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleTestConnection}
                disabled={testConnection.isPending}
              >
                <Plug className="h-4 w-4" />
                {testConnection.isPending ? "Testing..." : "Test Connection"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={
                  forceResync.isPending ||
                  connector.lastSyncStatus === "running"
                }
                onClick={() => setIsForceResyncOpen(true)}
              >
                <RotateCcw className="h-4 w-4" />
                {forceResync.isPending ? "Starting..." : "Force Re-sync"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <FormDialog
            open={isForceResyncOpen}
            onOpenChange={setIsForceResyncOpen}
            title="Force Re-sync"
            description="This will delete all documents, chunks, and sync history for this connector, then start a fresh sync from scratch. This action cannot be undone."
            size="small"
          >
            <DialogStickyFooter className="mt-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsForceResyncOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  forceResync.mutate(connectorId);
                  setIsForceResyncOpen(false);
                }}
              >
                Force Re-sync
              </Button>
            </DialogStickyFooter>
          </FormDialog>
        </div>
      }
    >
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {backLabel}
          </Link>
        </Button>

        <div className="rounded-lg border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
            <MetadataItem label="Last Sync">
              <div>
                {connector.lastSyncAt
                  ? formatDate({ date: connector.lastSyncAt })
                  : "Never"}
              </div>
            </MetadataItem>
            <MetadataItem label="Documents">
              <div>{connector.totalDocsIngested}</div>
            </MetadataItem>
            <MetadataItem label="Schedule">
              <div>{formatCronSchedule(connector.schedule)}</div>
            </MetadataItem>
            <KnowledgeBasesMetadataItem connectorId={connectorId} />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "sync" | "prune")}
        >
          <TabsList>
            <TabsTrigger value="sync">Sync</TabsTrigger>
            <TabsTrigger value="prune">Prune</TabsTrigger>
          </TabsList>

          <TabsContent value="sync" className="mt-4">
            <ConnectorSyncRuns
              connectorId={connectorId}
              onViewLogs={setSelectedRunId}
            />
          </TabsContent>

          <TabsContent value="prune" className="mt-4">
            <ConnectorPruneRuns
              connectorId={connectorId}
              onViewLogs={setSelectedRunId}
            />
          </TabsContent>
        </Tabs>

        <ConnectorRunDetailsDialog
          connectorId={connectorId}
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
        />

        <EditConnectorDialog
          connector={connector}
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
        />
      </div>
    </PageLayout>
  );
}

function KnowledgeBasesMetadataItem({ connectorId }: { connectorId: string }) {
  const { data: assignedKbs, isPending } =
    useConnectorKnowledgeBases(connectorId);
  const { data: allKbs } = useKnowledgeBases();
  const assignMutation = useAssignConnectorToKnowledgeBases();
  const unassignMutation = useUnassignConnectorFromKnowledgeBase();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedKbId, setSelectedKbId] = useState<string>("");

  const assignedIds = new Set((assignedKbs?.data ?? []).map((kb) => kb.id));
  const availableKbs = (allKbs ?? []).filter((kb) => !assignedIds.has(kb.id));

  const handleAssign = useCallback(async () => {
    if (!selectedKbId) return;
    const result = await assignMutation.mutateAsync({
      connectorId,
      knowledgeBaseIds: [selectedKbId],
    });
    if (result) {
      setSelectedKbId("");
      setIsAddDialogOpen(false);
    }
  }, [selectedKbId, connectorId, assignMutation]);

  const handleUnassign = useCallback(
    async (knowledgeBaseId: string) => {
      await unassignMutation.mutateAsync({ connectorId, knowledgeBaseId });
    },
    [connectorId, unassignMutation],
  );

  const kbItems = assignedKbs?.data ?? [];

  return (
    <MetadataItem label="Knowledge Bases">
      {isPending ? (
        <LoadingSpinner />
      ) : kbItems.length === 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">None</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {kbItems.map((kb) => (
            <Badge key={kb.id} variant="secondary" className="gap-1 pr-1">
              <Database className="h-3 w-3" />
              {kb.name}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 ml-0.5 hover:bg-destructive/20"
                onClick={() => handleUnassign(kb.id)}
                disabled={unassignMutation.isPending}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setIsAddDialogOpen(true)}
            disabled={availableKbs.length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign to Knowledge Base</DialogTitle>
            <DialogDescription>
              Select a knowledge base to assign this connector to.
            </DialogDescription>
          </DialogHeader>
          <DialogForm onSubmit={handleAssign}>
            <div className="py-2">
              <Select value={selectedKbId} onValueChange={setSelectedKbId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a knowledge base" />
                </SelectTrigger>
                <SelectContent>
                  {availableKbs.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!selectedKbId || assignMutation.isPending}
              >
                {assignMutation.isPending ? "Assigning..." : "Assign"}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </MetadataItem>
  );
}
