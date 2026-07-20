/**
 * Sort options for tree-view items.
 */
export type TreeSortOrder = 'newest' | 'oldest' | 'recently-updated' | 'most-commented';

export const TREE_SORT_OPTIONS: { label: string; value: TreeSortOrder; description?: string }[] = [
  { label: 'Newest', value: 'newest', description: 'created time, descending' },
  { label: 'Oldest', value: 'oldest', description: 'created time, ascending' },
  { label: 'Recently Updated', value: 'recently-updated', description: 'updated time, descending' },
  { label: 'Most Commented', value: 'most-commented', description: 'comment count, descending' },
];

interface DatedItem {
  created_at?: string;
  updated_at?: string;
  comments?: number;
}

function timeOf(s: string | undefined): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Returns a comparator suitable for `Array.prototype.sort` for the given order.
 */
export function makeComparator<T extends DatedItem>(order: TreeSortOrder): (a: T, b: T) => number {
  switch (order) {
    case 'oldest':
      return (a, b) => timeOf(a.created_at) - timeOf(b.created_at);
    case 'recently-updated':
      return (a, b) => timeOf(b.updated_at) - timeOf(a.updated_at);
    case 'most-commented':
      return (a, b) => (b.comments ?? 0) - (a.comments ?? 0);
    case 'newest':
    default:
      return (a, b) => timeOf(b.created_at) - timeOf(a.created_at);
  }
}

export function sortTreeItems<T extends DatedItem>(items: T[], order: TreeSortOrder): T[] {
  return [...items].sort(makeComparator<T>(order));
}
