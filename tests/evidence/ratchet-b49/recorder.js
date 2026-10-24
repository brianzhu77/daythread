// B49: records what the browser does while he types into the editor, for comparing a real iOS composition with our
// WebKit replay. Paste into the page (or inject before load); read back with JSON.stringify(window.__b49log).
// Each entry: t (ms since start), ev (event or "mut"), and what matters for it: key/keyCode/isComposing, inputType/data,
// the caret's block id and offset, and for DOM changes the block ids added/removed and the text of the caret block.
(() => {
  if (window.__b49log) return
  const log = window.__b49log = [], t0 = performance.now()
  const blockOf = node => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest?.('[data-node-type="blockContainer"]')
  const caret = () => { const s = getSelection(); if (!s || !s.rangeCount) return null; const b = blockOf(s.anchorNode); return { block: b?.dataset.id ?? null, offset: s.anchorOffset, node: s.anchorNode?.nodeName } }
  const blocks = () => [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].map(b => b.dataset.id)
  const push = (ev, extra) => log.push({ t: Math.round(performance.now() - t0), ev, caret: caret(), ...extra })
  for (const type of ['keydown', 'keyup']) document.addEventListener(type, e => push(type, { key: e.key, keyCode: e.keyCode, isComposing: e.isComposing }), true)
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(type, e => push(type, { data: e.data }), true)
  for (const type of ['beforeinput', 'input']) document.addEventListener(type, e => push(type, { inputType: e.inputType, data: e.data, isComposing: e.isComposing }), true)
  document.addEventListener('selectionchange', () => push('selectionchange'))
  let known = new Set(blocks())
  const observe = () => {
    const root = document.querySelector('.bn-editor')
    if (!root) return setTimeout(observe, 200)
    new MutationObserver(records => {
      const now = blocks(), added = now.filter(id => !known.has(id)), removed = [...known].filter(id => !now.includes(id))
      known = new Set(now)
      const c = caret(), block = c?.block && root.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(c.block)}"] .bn-inline-content`)
      push('mut', { records: records.length, kinds: [...new Set(records.map(r => r.type))], added, removed, text: block?.textContent ?? null, html: block?.innerHTML.slice(0, 160) ?? null })
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-empty-and-focused', 'class'] })
  }
  observe()
})()
