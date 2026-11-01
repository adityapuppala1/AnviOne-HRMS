// Whitelisted ORDER BY builder. Callers map each allowed sort key to a fixed SQL
// expression; user input only ever selects a key, it is never interpolated.
export type SortDir = "asc" | "desc";

export function buildOrderBy<K extends string>(
  columns: Readonly<Record<K, string>>,
  sort: K | undefined,
  dir: SortDir,
  fallback: string,
  tiebreak: string,
): string {
  if (sort === undefined || !Object.hasOwn(columns, sort)) return fallback;
  const direction = dir === "desc" ? "DESC" : "ASC";
  return `${columns[sort]} ${direction} NULLS LAST, ${tiebreak}`;
}
