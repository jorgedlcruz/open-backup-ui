/** One registry drives the sidebar, Lens tiles, routes, and landing preference. */
export const lenses = [
  { id: 'overview', title: 'Overview', category: 'Estate health', description: 'Your protection picture, priorities, and next move.', href: '/vbr/lens/overview' },
  { id: 'operations', title: 'Job Operations', category: 'Daily operations', description: 'Follow active runs and investigate exceptions.', href: '/vbr/lens/operations' },
  { id: 'capacity', title: 'Capacity Watch', category: 'Storage health', description: 'Find storage pressure and protect your headroom.', href: '/vbr/lens/capacity' },
  { id: 'forecast', title: 'Capacity Forecast', category: 'Storage planning', description: 'Explore retention, backup growth, and tomorrow’s storage demand.', href: '/vbr/lens/forecast' },
] as const
export type LensId = typeof lenses[number]['id']
export const lensCookie = 'protection_lens_default'
export function isLensId(value: unknown): value is LensId { return lenses.some(lens => lens.id === value) }
export function defaultLens(value: unknown): LensId { return isLensId(value) ? value : 'overview' }
export function lensHref(value: unknown) { return lenses.find(lens => lens.id === defaultLens(value))!.href }
export function lensForPath(path: string) { return lenses.find(lens => lens.href === path)?.id ?? null }
export function legacyLensTarget(view: LensId, query: Record<string, string | string[] | undefined> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  return `${lensHref(view)}${params.size ? `?${params}` : ''}`
}
