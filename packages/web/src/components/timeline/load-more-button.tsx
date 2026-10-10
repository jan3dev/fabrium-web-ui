import { LoaderIcon } from "@/components/icons";

export function LoadMoreButton({
  loading,
  hasMore,
  onClick,
}: {
  loading: boolean;
  hasMore: boolean;
  onClick: () => void;
}) {
  if (!hasMore && !loading) return null;
  return (
    <div className="flex justify-center py-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || !hasMore}
        className="flex items-center gap-1.5 rounded-pill px-3 py-1 text-caption1 text-text-secondary hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
      >
        {loading && <LoaderIcon className="h-3 w-3 animate-spin" />}
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
