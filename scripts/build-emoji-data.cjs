// Builds public/emoji-v1.json from emojibase-data (MIT): [char, group, English words, Chinese words, tones?]. Up to Emoji 15, so a phone from a year or two ago draws them.
const en = require('emojibase-data/en/data.json'), zh = require('emojibase-data/zh/data.json'), byHex = new Map(zh.map(e => [e.hexcode, e]))
const names = ['Smileys', 'People', null, 'Animals & nature', 'Food & drink', 'Travel & places', 'Activities', 'Objects', 'Symbols', 'Flags']
const words = e => e ? [e.label, ...(e.tags ?? [])].join(' ') : ''
const usable = en.filter(e => e.group !== undefined && e.group !== 2 && e.version <= 15).sort((a, b) => a.group - b.group || a.order - b.order)
const emoji = usable.map(e => {
  const tones = (e.skins ?? []).filter(s => typeof s.tone === 'number').map(s => s.emoji)
  return [e.emoji, e.group, words(e), words(byHex.get(e.hexcode)), ...(tones.length === 5 ? [tones] : [])]
})
process.stdout.write(JSON.stringify({ groups: names, emoji }))
