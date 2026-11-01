import { editorSeed, inlineText, pageNodes, type EditorNode } from './editor-document.ts'
import type { Page, Workspace } from './types.ts'
import { isTemplate } from './day-template.ts'
import { isDraft } from './day-draft.ts'
import { cellValue, databaseOfRow, databaseRows, isDatabase, isEmptyValue, propertyOf, type CellValue, type Database } from './database.ts'

/**
 * Export: his words out of the app, readable without its code. A folder of Markdown (a day page per date, a document
 * page per title) that opens as an Obsidian vault, plus `workspace.json` with every fact behind it. Read-only.
 */
export const exportFormatVersion = 2

export interface ExportFile { path: string; text: string }

export function exportFiles(ws: Workspace, now: Date): ExportFile[] {
  const day = now.toLocaleDateString('en-CA', { timeZone: ws.timezone })
  const root = `daythread-export-${day}`
  const names = fileNames(ws)
  const live = ws.pages.filter(p => !p.trashedAt && !isDraft(p))
  const days = live.filter(p => p.type === 'daily' && p.date).sort((a, b) => (a.date! < b.date! ? -1 : 1))
  const templates = live.filter(isTemplate)
  const documents = live.filter(p => !(p.type === 'daily' && p.date) && !isTemplate(p) && !isDraft(p)).sort((a, b) => names.get(a.id)!.localeCompare(names.get(b.id)!))
  return [
    { path: `${root}/README.md`, text: readme(day, ws.timezone) },
    ...days.map(p => ({ path: `${root}/days/${names.get(p.id)}.md`, text: pageMarkdown(p, ws, names) })),
    ...documents.map(p => ({ path: `${root}/pages/${names.get(p.id)}.md`, text: pageMarkdown(p, ws, names) })),
    // His templates are his setup, kept with the rest (Bumblebee 981cfd3f), in their own folder rather than as pages.
    ...templates.map(p => ({ path: `${root}/templates/${names.get(p.id)}.md`, text: pageMarkdown(p, ws, names) })),
    { path: `${root}/workspace.json`, text: JSON.stringify(exportJson(ws, now, names), null, 2) },
  ]
}

/** A file name per page: a day page by its date; any other page by its title, with " (2)" for a second page of the same title. */
export function fileNames(ws: Workspace): Map<string, string> {
  const names = new Map<string, string>(), taken = new Set<string>()
  const pages = [...ws.pages].sort((a, b) => (a.type === b.type ? 0 : a.type === 'daily' ? -1 : 1))
  for (const p of pages) {
    const base = p.type === 'daily' && p.date ? p.date : safeName(p.title)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
    taken.add(name.toLowerCase())
    names.set(p.id, name)
  }
  return names
}
export function safeName(title: string): string {
  const name = title.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  const short = [...name].slice(0, 120).join('')
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(short) ? `${short}-` : short || 'Untitled'
}

/** One page as Markdown: its title, then its document as he sees it, nesting kept, to-dos as `- [ ]` / `- [x]`. */
export function pageMarkdown(p: Page, ws: Workspace, names: Map<string, string>): string {
  // A template's parentId is its target ("days"), not a page it sits in.
  const template = isTemplate(p)
  const parent = p.parentId && !template ? names.get(p.parentId) : undefined
  // A row's values are its properties, written as front matter so Obsidian reads them as such.
  const db = databaseOfRow(ws, p)
  const values = db ? db.database.properties.flatMap(property => { const v = cellValue(db.database, p, property.id); return isEmptyValue(v) ? [] : [`${yamlString(property.name)}: ${yamlString(valueText(db.database, property.id, v))}`] }) : []
  const front = ['---', `daythread-id: ${yamlString(p.id)}`, ...(p.date ? [`date: ${p.date}`] : []), ...(p.url ? [`url: ${yamlString(p.url)}`] : []), ...(parent ? [`parent: ${yamlString(`[[${parent}]]`)}`] : []), ...(template && p.parentId ? [`template-for: ${yamlString(p.parentId)}`] : []), ...values, '---']
  const title = p.type === 'daily' && p.date ? p.date : p.title || 'Untitled'
  const body = [p.url ? `<${p.url}>` : '', isDatabase(p) ? databaseMarkdown(ws, p, names) : '', blocksMarkdown(editorSeed(p, ws), ws, names)].filter(Boolean).join('\n\n')
  return `${front.join('\n')}\n\n# ${title}\n${body ? `\n${body}\n` : ''}`
}

export function blocksMarkdown(nodes: EditorNode[], ws: Workspace, names: Map<string, string>): string {
  const out: string[] = []
  let previousList = false
  const write = (n: EditorNode, depth: number) => {
    const lines = blockLines(n, ws, names, depth > 0 || Boolean(n.children?.length))
    const kids = n.children ?? []
    if (!lines.length && !kids.length) return
    const isList = depth > 0 || lines[0]?.startsWith('- ') || lines[0]?.startsWith('1. ') || false
    if (depth === 0 && out.length && !(isList && previousList)) out.push('')
    const pad = '\t'.repeat(depth)
    out.push(...lines.map(l => pad + l))
    if (depth === 0) previousList = isList
    const childDepth = lines.length ? depth + 1 : depth
    kids.forEach(k => write(k, childDepth))
  }
  nodes.forEach(n => write(n, 0))
  return out.join('\n')
}

function blockLines(n: EditorNode, ws: Workspace, names: Map<string, string>, asItem: boolean): string[] {
  const text = inlineMarkdown(n.content, ws, names).trim()
  const props = (n.props ?? {}) as Record<string, unknown>
  switch (n.type) {
    case 'heading': {
      if (!text) return []
      return asItem ? [`- **${text}**`] : [`${'#'.repeat(Math.min(Math.max(Number(props.level ?? 2), 1), 6))} ${text}`]
    }
    case 'task': {
      const task = ws.tasks.find(t => t.id === props.taskId)
      if (!text && !task?.title.trim()) return []
      const mark = task?.status === 'done' ? 'x' : task?.status === 'cancelled' ? '-' : ' '
      return [`- [${mark}] ${text || task!.title.trim()}`]
    }
    case 'checkListItem':
    case 'sourceChecklist':
      return text ? [`- [${props.checked ? 'x' : ' '}] ${text}`] : []
    case 'bulletListItem':
    case 'toggleListItem':
      return text ? [`- ${text}`] : []
    case 'numberedListItem':
      return text ? [`1. ${text}`] : []
    case 'quote':
      return text ? [asItem ? `- > ${text}` : `> ${text}`] : []
    case 'codeBlock': {
      const code = inlineText(n.content)
      return code ? ['```' + String(props.language ?? ''), ...code.split('\n'), '```'] : []
    }
    case 'divider':
      return asItem ? [] : ['---']
    case 'database': {
      const target = typeof props.pageId === 'string' && props.pageId ? names.get(props.pageId) : undefined
      return target ? [`${asItem ? '- ' : ''}[[${target}]]`] : []
    }
    case 'pageLink': {
      const target = typeof props.pageId === 'string' && props.pageId ? names.get(props.pageId) : undefined
      if (target) return [`${asItem ? '- ' : ''}[[${target}]]`]
      return typeof props.url === 'string' && props.url ? [`${asItem ? '- ' : ''}<${props.url}>`] : []
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'file': {
      const url = String(props.url ?? '')
      if (!url) return []
      const label = String(props.caption || props.name || n.type)
      return [`${asItem ? '- ' : ''}${n.type === 'image' ? '!' : ''}[${label}](${url})`]
    }
    case 'table': {
      const rows = ((n.content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows ?? []).map(r => (r.cells ?? []).map(c => inlineMarkdown((c as { content?: unknown })?.content ?? c, ws, names).replace(/\|/g, '\\|').trim()))
      if (!rows.length) return []
      const width = Math.max(...rows.map(r => r.length)), row = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [row(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(row)]
    }
    default:
      return text ? [asItem ? `- ${text}` : text] : []
  }
}

/** A cell as text: option names, a date range with an arrow, a ticked box as "Yes". */
export function valueText(db: Database, columnId: string, value: CellValue): string {
  const property = propertyOf(db, columnId)
  const name = (id: string) => property?.options?.find(o => o.id === id)?.name ?? ''
  if (value === null || value === false) return ''
  if (value === true) return 'Yes'
  if (Array.isArray(value)) return value.map(name).filter(Boolean).join(', ')
  if (typeof value === 'object') return value.end ? `${value.start} → ${value.end}` : value.start
  if (property && (property.type === 'select' || property.type === 'status')) return name(String(value))
  return String(value)
}
/** A database page: its rows as a table in page order (title linked to the row's file), one column per property. */
function databaseMarkdown(ws: Workspace, p: Page & { database: Database }, names: Map<string, string>): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  const columns = p.database.properties
  const header = `| Name |${columns.map(c => ` ${cell(c.name)} |`).join('')}`
  const rows = databaseRows(ws, p.id).map(r => `| ${names.has(r.id) ? `[[${names.get(r.id)}]]` : cell(r.title || 'Untitled')} |${columns.map(c => ` ${cell(valueText(p.database, c.id, cellValue(p.database, r, c.id)))} |`).join('')}`)
  return [header, `|${' --- |'.repeat(columns.length + 1)}`, ...rows].join('\n')
}

type Inline = { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown; props?: Record<string, unknown> }

/** Words with their styles, links as links, `[[page]]` links by the target's file name, chips as their text. */
export function inlineMarkdown(content: unknown, ws: Workspace, names: Map<string, string>): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Inline[]).map(c => {
    if (!c || typeof c !== 'object') return ''
    if (c.type === 'link') return `[${inlineMarkdown(c.content, ws, names) || c.href}](${c.href ?? ''})`
    if (c.type === 'pageRef') {
      const id = String(c.props?.pageId ?? ''), target = names.get(id)
      if (target) return `[[${target}]]`
      return String(c.props?.newTitle || ws.pages.find(p => p.id === id)?.title || '')
    }
    if (c.type === 'dateMention') return inlineText([c])
    if (c.type !== 'text' || !c.text) return ''
    return styled(c.text, c.styles ?? {})
  }).join('')
}
function styled(text: string, styles: Record<string, unknown>): string {
  if (styles.code) return `\`${text}\``
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  if (!core) return text
  let out = core
  if (styles.strike) out = `~~${out}~~`
  if (styles.italic) out = `*${out}*`
  if (styles.bold) out = `**${out}**`
  return `${lead}${out}${trail}`
}
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** Every fact, readable without the app: pages with their documents (BlockNote JSON) and Markdown file, and tasks. */
export function exportJson(ws: Workspace, now: Date, names = fileNames(ws)) {
  const pages = ws.pages.map(p => {
    const { document: _document, ...rest } = p
    const folder = p.type === 'daily' && p.date ? 'days' : isTemplate(p) ? 'templates' : 'pages'
    return { ...rest, document: pageNodes(p), markdownFile: p.trashedAt ? null : `${folder}/${names.get(p.id)}.md` }
  })
  return { format: 'daythread-export', formatVersion: exportFormatVersion, exportedAt: now.toISOString(), schemaVersion: ws.schemaVersion, revision: ws.revision, timezone: ws.timezone, pages, tasks: ws.tasks }
}

function readme(day: string, timezone: string): string {
  return `# Daythread export · ${day}

- \`days/\`: one Markdown file per day page, named by its date (${timezone}).
- \`pages/\`: one Markdown file per page that isn't a day. \`[[links]]\` point at these files by name, so the folder opens as an Obsidian vault.
- \`templates/\`: one Markdown file per template; \`template-for: days\` marks the one new day pages start from.
- \`workspace.json\`: every fact behind the pages (pages with their documents, tasks, trashed pages), format \`daythread-export\` version ${exportFormatVersion}. A page's \`document\` is BlockNote JSON; \`markdownFile\` names its Markdown file.

To-dos are \`- [ ]\` open, \`- [x]\` done, \`- [-]\` cancelled. Nested lines are indented one tab per level.
`
}
