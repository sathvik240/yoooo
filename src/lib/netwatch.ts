/**
 * Counts requests this page makes to any origin other than its own, using
 * the browser's own Resource Timing records. Shown in the masthead so the
 * "nothing leaves your device" promise is something you can watch.
 */
export function watchNetwork(onChange: (outside: number) => void): void {
  if (typeof PerformanceObserver === 'undefined') return
  const seen = new Set<string>()
  let outside = 0
  const take = (entries: PerformanceEntryList) => {
    for (const e of entries) {
      const key = `${e.name}@${e.startTime}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const u = new URL(e.name)
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin) outside++
      } catch {
        /* not a URL */
      }
    }
    onChange(outside)
  }
  take(performance.getEntriesByType('resource'))
  new PerformanceObserver((list) => take(list.getEntries())).observe({ type: 'resource', buffered: true })
}
