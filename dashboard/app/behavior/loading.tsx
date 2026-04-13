import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the Behavior server component fetches paginated results.
 * Mirrors: title + filter row + pagination controls + result table.
 */
export default function BehaviorLoading(): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Filter row */}
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

      {/* Pagination controls */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      </div>

      {/* Results table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex gap-4 border-b px-4 py-3">
            {[100, 80, 140, 100, 80, 120].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
              {[100, 80, 140, 100, 80, 120].map((w, j) => (
                <Skeleton key={j} className="h-4" style={{ width: w }} />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
