// Server-only OpenRouter client. The key never leaves the server and is never logged.

export interface ModelConfig { apiKey: string; model: string; baseUrl: string }
export interface ModelCall<T> { value: T; generationId: string | null; costUsd: number | null; promptTokens: number; completionTokens: number; raw: string }

// Used when OPENROUTER_MODEL is unset, so a deploy with only the key still has a model.
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

/** Reads the key the server was started with; null means "no model: say Simulated". */
export function modelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim(), model = env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL
  // OPENROUTER_BASE_URL exists so tests can point at a local fake provider; production leaves it unset.
  return apiKey && model ? { apiKey, model, baseUrl: (env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/$/, '') } : null
}

export type ModelErrorKind = 'auth' | 'limit' | 'unavailable' | 'invalid-output' | 'timeout'
export class ModelError extends Error {
  readonly kind: ModelErrorKind
  /** What the model actually sent, when there was an answer (kept for audits; never logged by default). */
  readonly raw: string | null
  readonly costUsd: number | null
  /** Set when the provider answered with an HTTP error. The status alone doesn't prove nothing was charged. */
  readonly httpStatus: number | null
  readonly generationId: string | null
  constructor(message: string, kind: ModelErrorKind, raw: string | null = null, costUsd: number | null = null, httpStatus: number | null = null, generationId: string | null = null) { super(message); this.kind = kind; this.raw = raw; this.costUsd = costUsd; this.httpStatus = httpStatus; this.generationId = generationId }
}

export async function callStructured<T>(config: ModelConfig, messages: { role: string; content: string }[], schema: { name: string; strict: boolean; schema: unknown }, options: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; reasoning?: boolean; fetchImpl?: typeof fetch } = {}): Promise<ModelCall<T>> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000)
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Daythread' },
      body: requestBody(config, messages, schema, options),
    })
  } catch (error) {
    throw new ModelError(error instanceof Error && error.name === 'TimeoutError' ? 'Model timed out' : 'Model unreachable', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unavailable')
  }
  const body = await response.json().catch(() => null) as { id?: string; choices?: { message?: { content?: string } }[]; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } } | null
  const costUsd = typeof body?.usage?.cost === 'number' && Number.isFinite(body.usage.cost) && body.usage.cost >= 0 ? body.usage.cost : null
  const generationId = typeof body?.id === 'string' && body.id ? body.id : null
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? 'auth' : response.status === 402 || response.status === 429 ? 'limit' : 'unavailable'
    throw new ModelError(`Model request failed (${response.status})`, kind, null, costUsd, response.status, generationId)
  }
  const raw = body?.choices?.[0]?.message?.content ?? ''
  if (body?.choices?.[0] && (body.choices[0] as { finish_reason?: string }).finish_reason === 'length') throw new ModelError('Model ran out of output tokens', 'invalid-output', raw, costUsd, null, generationId)
  let value: T
  try { value = JSON.parse(raw) as T } catch { throw new ModelError('Model returned text that is not JSON', 'invalid-output', raw, costUsd, null, generationId) }
  return { value, raw, generationId, costUsd, promptTokens: body?.usage?.prompt_tokens ?? 0, completionTokens: body?.usage?.completion_tokens ?? 0 }
}

/** The exact JSON sent: also what the budget's worst case and the attempt's request hash are computed from. */
export function requestBody(config: ModelConfig, messages: { role: string; content: string }[], schema: { name: string; strict: boolean; schema: unknown }, options: { maxTokens?: number; reasoning?: boolean } = {}): string {
  return JSON.stringify({
    model: config.model, messages,
    response_format: { type: 'json_schema', json_schema: schema },
    provider: { require_parameters: true },
    max_tokens: options.maxTokens ?? 4000,
    usage: { include: true },
    // Reasoning models spend output tokens thinking; when that hits max_tokens the answer comes back empty.
    ...(options.reasoning === false ? { reasoning: { enabled: false } } : {}),
  })
}
