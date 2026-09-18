import { PageSkeleton } from "@/components/common/page-skeleton";

/** Shown by Next.js while a page in this segment loads (route transitions, code splitting). */
export default function Loading() {
  return <PageSkeleton />;
}
