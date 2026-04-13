import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the Trades server component fetches paginated trade data.
 * Mirrors the filter card + table layout.
 */
export default function TradesLoading(): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Filter card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-16" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trade table */}
      <Card>
        <CardContent className="p-0">
          {/* Table header */}
          <div className="flex gap-4 border-b px-4 py-3">
            {[80, 120, 80, 80, 80, 80, 80, 100, 120].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: w }} />
            ))}
          </div>
          {/* Table rows */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
              {[80, 120, 80, 80, 80, 80, 80, 100, 120].map((w, j) => (
                <Skeleton key={j} className="h-4" style={{ width: w }} />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
