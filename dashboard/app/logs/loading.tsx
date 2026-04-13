import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the Logs server component fetches bot log rows.
 * Mirrors the filter card + streamed table layout.
 */
export default function LogsLoading(): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Filter card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-16" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-16" />
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex gap-4 border-b px-4 py-3">
            {[160, 140, 60, 120, 200].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
              {[160, 140, 60, 120, 200].map((w, j) => (
                <Skeleton key={j} className="h-4" style={{ width: w }} />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
