import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "./page-header";

/**
 * Placeholder shown while a page or its data loads, so navigation never lands on a blank
 * screen. Used by the route-level loading.tsx and by pages waiting on IndexedDB queries.
 */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <PageContainer>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading…
      </span>
    </PageContainer>
  );
}

/** A single card-sized placeholder, for sections that load independently. */
export function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={className ?? "h-28 w-full rounded-xl"} />;
}
