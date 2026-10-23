// B3: renders an export's day file with markdown-it + task lists (GFM), as a stand-in for Obsidian's reader.
//   (needs markdown-it and markdown-it-task-lists installed next to it)   node gfm-render.mjs <export.zip>
import MarkdownIt from 'markdown-it'
import tasks from 'markdown-it-task-lists'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
const zip = unzipSync(readFileSync(process.argv[2]))
const day = Object.keys(zip).find(k => /\/days\/.*\.md$/.test(k))
const html = new MarkdownIt().use(tasks).render(strFromU8(zip[day]).replace(/^---[\s\S]*?---\n/, ''))
console.log(html)
