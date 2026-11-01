export type HealthSection = { title: string; content: string; thinkingProcess: string | null }

/** Share the same complete report between the tabbed view and PDF export. */
export function readHealthSections(completion: string, overviewTitle: string): HealthSection[] {
  if (!completion.trim()) return []
  const parts = completion.split(/(?:^|\n)###\s+/)
  const sections: HealthSection[] = parts.slice(1).map(part => {
    const newline = part.indexOf('\n')
    const title = (newline < 0 ? part : part.slice(0, newline)).trim()
    let content = newline < 0 ? '' : part.slice(newline).trim()
    const thinking = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/i
    const match = content.match(thinking)
    if (match) content = content.replace(thinking, '').trim()
    return { title, content, thinkingProcess: match?.[1].trim() || null }
  })
  if (parts[0].trim()) {
    const overview = sections.find(section => section.title.toLowerCase().includes('overview'))
    if (overview) overview.content = `${parts[0].trim()}\n\n${overview.content}`
    else sections.unshift({ title: overviewTitle, content: parts[0].trim(), thinkingProcess: null })
  }
  const unique: HealthSection[] = []
  for (const section of sections) {
    const base = section.title.split('|')[0].trim().toLowerCase()
    const existing = unique.find(item => item.title.split('|')[0].trim().toLowerCase() === base)
    if (existing) {
      existing.content += `\n\n${section.content}`
      existing.thinkingProcess ||= section.thinkingProcess
      existing.title = section.title
    } else if (section.title || section.content) unique.push(section)
  }
  return unique
}
