import React from "react";
import { Skeleton } from "../ui/skeleton";
import { Card, CardContent, CardHeader } from "../ui/card";

/**
 * Loading skeletons for different page sections.
 */

export function PageHeaderSkeleton(): React.ReactElement {
  return (
    <div className="page-header">
      <Skeleton className="h-8 w-64 mb-2" />
      <Skeleton className="h-5 w-96" />
    </div>
  );
}

export function MetricCardSkeleton(): React.ReactElement {
  return (
    <Card>
      <CardContent className="pt-6">
        <Skeleton className="h-4 w-20 mb-2" />
        <Skeleton className="h-10 w-32" />
      </CardContent>
    </Card>
  );
}

export function RunCardSkeleton(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-2" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }): React.ReactElement {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}



