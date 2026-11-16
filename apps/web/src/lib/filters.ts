/** Un ensemble de filtres avec `value` en plus ou en moins : une coche de « Filtrer ▾ ». */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
