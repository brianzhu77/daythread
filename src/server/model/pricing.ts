// The model's price, read from OpenRouter and kept for a day. Unknown or stale price = no call (03 E3 point 3).
export interface Price { promptPerToken: number; completionPerToken: number; checkedAt: number }
let cached: { model: string; price: Price } | null = null
const day = 24 * 60 * 60 * 1000

/** The highest rate the route can charge at any hour, so the reservation is a true upper bound. */
export async function modelPrice(model: string, apiKey: string, baseUrl: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Price | null> {
  if (cached && cached.model === model && now - cached.price.checkedAt < day) return cached.price
  try {
    const r = await fetchImpl(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const body = await r.json() as { data?: { id: string; pricing?: { prompt: string; completion: string; overrides?: { prompt: string; completion: string }[] } }[] }
    const pricing = body.data?.find(m => m.id === model)?.pricing
    if (!pricing) return null
    const peak = (k: 'prompt' | 'completion') => Math.max(Number(pricing[k]), ...(pricing.overrides ?? []).map(o => Number(o[k])))
    const price = { promptPerToken: peak('prompt'), completionPerToken: peak('completion'), checkedAt: now }
    if (![price.promptPerToken, price.completionPerToken].every(n => Number.isFinite(n) && n >= 0)) return null
    cached = { model, price }
    return price
  } catch { return null }
}
/** Tokens never exceed UTF-8 bytes, so bytes × input rate + max output × output rate bounds the charge (Ratchet). */
export function worstCaseUsd(requestBody: string, maxOutputTokens: number, price: Price): number {
  return Buffer.byteLength(requestBody, 'utf8') * price.promptPerToken + maxOutputTokens * price.completionPerToken
}
export function resetPriceCache() { cached = null }
