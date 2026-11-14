// Ids the domain makes while it applies a command. Inside `applyCommand` they come from the operation's own id, so the
// browser's prediction of a change (the outbox, docs/design/outbox.md §4) and the server's applying of it make the same
// ids, and a later change that names one (tick the to-do it just added) means the same thing on both. Outside a command
// they are random, as before.

let source: (() => string) | null = null

/** A UUID-shaped id: the operation's next one inside a command, else random. */
export const newId = (): string => (source ? source() : crypto.randomUUID())

/** 128 bits of hash from a string (cyrb128): four 32-bit seeds. */
function seeds(text: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** The ids of one operation, in order (sfc32 over its seeds), formatted as v4-style UUIDs. */
export function idsFor(operationId: string): () => string {
  let [a, b, c, d] = seeds(`daythread-ids:${operationId}`)
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0
    return t >>> 0
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  return () => {
    const w = [next(), next(), next(), next()].map(hex).join('')
    return `${w.slice(0, 8)}-${w.slice(8, 12)}-4${w.slice(13, 16)}-${((parseInt(w[16]!, 16) & 0x3) | 0x8).toString(16)}${w.slice(17, 20)}-${w.slice(20, 32)}`
  }
}

/** Runs `fn` with the operation's ids; nested calls keep the outer operation's. */
export function withOperationIds<T>(operationId: string, fn: () => T): T {
  if (source) return fn()
  source = idsFor(operationId)
  try { return fn() } finally { source = null }
}
