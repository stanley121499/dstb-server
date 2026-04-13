import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the Config editor server component loads.
 * Mirrors the two-column form layout: form sections + optional version history sidebar.
 */
export default function ConfigLoading(): React.ReactElement {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>

        {/* Basics card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-14" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-9 w-full" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Sizing & risk card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* JSON params card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>

        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Version history sidebar skeleton */}
      <Card className="h-fit">
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
