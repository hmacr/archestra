"use client";

import type { archestraApiTypes } from "@shared";
import type { ColumnDef } from "@tanstack/react-table";
import { Logs } from "lucide-react";
import { useCallback, useState } from "react";
import { ConnectorStatusBadge } from "@/app/knowledge/knowledge-bases/_parts/connector-status-badge";
import { LoadingSpinner, LoadingWrapper } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnectorRuns } from "@/lib/knowledge/connector.query";
import { formatDate } from "@/lib/utils";

type ConnectorRunItem =
  archestraApiTypes.GetConnectorRunsResponses["200"]["data"][number];

const PAGE_SIZE = 10;

const columns: ColumnDef<ConnectorRunItem>[] = [
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <ConnectorStatusBadge status={row.original.status} />,
  },
  {
    id: "startedAt",
    accessorKey: "startedAt",
    header: "Started",
    cell: ({ row }) => (
      <div className="font-mono text-xs">
        {formatDate({ date: row.original.startedAt })}
      </div>
    ),
  },
  {
    id: "completedAt",
    header: "Completed",
    cell: ({ row }) => (
      <div className="font-mono text-xs">
        {row.original.completedAt
          ? formatDate({ date: row.original.completedAt })
          : "-"}
      </div>
    ),
  },
  {
    id: "documentsProcessed",
    header: "Processed",
    cell: ({ row }) => {
      const processed = row.original.documentsProcessed ?? 0;
      const total = row.original.totalItems;
      return (
        <div>
          {processed}
          {total != null && total > 0 && (
            <span className="text-muted-foreground"> / {total}</span>
          )}
        </div>
      );
    },
  },
  {
    id: "documentsIngested",
    header: "Ingested",
    cell: ({ row }) => <div>{row.original.documentsIngested ?? 0}</div>,
  },
];

export function ConnectorSyncRuns({
  connectorId,
  onViewLogs,
}: {
  connectorId: string;
  onViewLogs: (runId: string) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);

  const { data, isPending } = useConnectorRuns({
    connectorId,
    type: "sync",
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  });

  const handlePaginationChange = useCallback(
    (newPagination: { pageIndex: number; pageSize: number }) => {
      setPageIndex(newPagination.pageIndex);
    },
    [],
  );

  const columnsWithLogs: ColumnDef<ConnectorRunItem>[] = [
    ...columns,
    {
      id: "logs",
      header: "Logs",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => onViewLogs(row.original.id)}
              aria-label="View run logs"
            >
              <Logs className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View logs</TooltipContent>
        </Tooltip>
      ),
    },
  ];

  return (
    <LoadingWrapper isPending={isPending} loadingFallback={<LoadingSpinner />}>
      {(data?.data ?? []).length === 0 ? (
        <div className="text-muted-foreground">
          No sync runs yet. Trigger a manual sync or wait for the scheduled
          sync.
        </div>
      ) : (
        <DataTable
          columns={columnsWithLogs}
          data={data?.data ?? []}
          manualPagination={true}
          pagination={{
            pageIndex,
            pageSize: PAGE_SIZE,
            total: data?.pagination?.total ?? 0,
          }}
          onPaginationChange={handlePaginationChange}
        />
      )}
    </LoadingWrapper>
  );
}
