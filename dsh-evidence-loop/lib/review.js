// 证据回路 · AI 复盘引擎。
//
// 职责：调 profile 默认模型 → 约束输出 JSON → 插件侧校验（维度/判定/原文强引用/next_actions）
// → 交给 machine.applyReview 计算状态。LLM 永远拿不到写状态的入口。
//
// 失败策略：解析或校验失败带原因重试 1 次；仍失败则把错误写到该版本上（节点停在「已提交」），
// 并记录 audit review_failed。用户可在界面点「重新复盘」。
import {
  BASE_DIMENSIONS, Blocked, REWORK_DIMENSION, applyReview, recordReviewFailure, retryableReviewNode,
} from './machine.js'
import { collectExternalEvidence } from './external.js'
import { appendAudit, findNode, listReviews, loadPaths, nowIso } from './store.js'

const MAX_CONTENT_CHARS = 12000
const MAX_OUTPUT_TOKENS = 1600
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_ATTEMPTS = 2

const running = new Map() // nodeId -> { submissionId, startedAt, controller }

const systemPrompt = (isRework) => [
  '你是「证据回路」的复盘审计员。你只做一件事：判断学习者本次提交的交付物是否满足节点要求，并按固定格式输出 JSON。',
  '',
  '硬规则：',
  `1. 维度固定为：${BASE_DIMENSIONS.join('、')}${isRework ? `，以及重做版本必须包含的「${REWORK_DIMENSION}」` : ''}。不要输出其他维度。`,
  '2. 每个维度的 verdict 只能是 "通过"、"部分通过"、"不通过" 之一。',
  '3. 每个维度的 reason 必须先用引号引用交付物中的一段原文（用「」或“”包住，至少 6 个字），再给出判断。禁止空泛评价；禁止引用交付物里没有的原文，插件会逐字校验。',
  '4. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释、前后缀或注释。',
  '5. next_actions 输出 1-2 条；每条 text 必须指向具体节点（可用 node_id）或具体提交动作，例如「补齐 B2 的来源页码后重新提交」。',
  '6. 你不改变任何状态；状态由插件根据你的判定计算。',
  '7. 若提供了外部检索结果，只把它当辅助证据：不得以检索结果作为「通过」的唯一依据；交付物引用了外部事实却没有可核查来源时，证据充分性应扣分。',
  '',
  'JSON 结构：',
  '{"dimensions":[{"name":"完成度","verdict":"通过","reason":"…「原文」…"}],"next_actions":[{"text":"…","node_id":"A2"}],"evidence_refs":[]}',
].join('\n')

function clipContent(content) {
  const text = String(content || '')
  if (text.length <= MAX_CONTENT_CHARS) return text
  return `${text.slice(0, MAX_CONTENT_CHARS)}\n\n…（交付物过长，已截断；原文共 ${text.length} 字符）`
}

function externalSection(external) {
  if (!external || !external.ran) return ''
  const lines = ['【外部检索结果（辅助证据，不得作为通过的唯一依据）】']
  if (external.sources && external.sources.length) {
    external.sources.forEach((source, index) => {
      lines.push(`${index + 1}. ${source.title || '(无标题)'} — ${source.snippet || ''} — ${source.url}（查询：${source.query}）`)
    })
  } else {
    lines.push('（未检索到可用来源）')
  }
  if (external.error) lines.push(`（部分检索失败：${external.error}）`)
  return lines.join('\n')
}

export function buildReviewRequest(node, path, version, previousReview, attempt, external) {
  const isRework = version.version > 1
  const previous = previousReview && Array.isArray(previousReview.dimensions)
    ? previousReview.dimensions.map((dim) => `- ${dim.name}：${dim.verdict} —— ${dim.reason}`).join('\n')
    : '（无）'
  const user = [
    '请复盘这次提交。',
    '',
    `【节点】${node.node_id} ${node.title}（路径 ${path.path_id} · ${path.title}，建议节奏 ${node.suggested_week}）`,
    `【通过本节点需要的证据】${node.evidence_required}`,
    `【提交版本】v${version.version}${isRework ? '（重做版本）' : '（首版）'} · ${version.submitted_at || nowIso()} · ${version.chars || 0} 字`,
    `【上一次复盘（用于判断${REWORK_DIMENSION}）】\n${previous}`,
    `【本次重做理由】${version.rework_reason || '（无）'}`,
    externalSection(external),
    '【交付物全文】',
    '"""',
    clipContent(version.content),
    '"""',
    attempt > 1 ? '【重要】上一次输出没有通过插件校验，请严格按 JSON 结构与引用规则重新输出。' : '',
  ].filter(Boolean).join('\n')
  return { system: systemPrompt(isRework), user, isRework }
}

// 从模型输出里抠出 JSON：容忍 ```json 围栏、前后解释文字，按花括号配对（忽略字符串内括号）。
export function parseReviewJson(text) {
  let source = String(text || '').trim()
  source = source.replace(/```(?:json)?/gi, '').trim()
  const start = source.indexOf('{')
  if (start < 0) throw new Error('模型输出里没有 JSON 对象。')
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) throw new Error('模型输出的 JSON 不完整。')
  let parsed
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch (err) {
    throw new Error(`模型输出的 JSON 无法解析：${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型输出的 JSON 不是对象。')
  if (!Array.isArray(parsed.dimensions)) throw new Error('复盘 JSON 缺少 dimensions 数组。')
  if (!Array.isArray(parsed.next_actions)) throw new Error('复盘 JSON 缺少 next_actions 数组。')
  return parsed
}

export function reviewRunningFor(nodeId, submissionId) {
  const job = running.get(nodeId)
  if (!job) return false
  return submissionId === undefined || job.submissionId === submissionId
}

export function abortAllReviews() {
  for (const job of running.values()) {
    try { job.controller.abort(new Error('插件卸载，复盘中止')) } catch {}
  }
  running.clear()
}

function readCurrent(nodeId, submissionId) {
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) throw new Error(`没有这个学习节点：${nodeId}`)
  const version = found.node.versions[found.node.versions.length - 1]
  if (!version || version.submission_id !== submissionId) {
    throw new Error('提交版本已经变化，放弃这次复盘。')
  }
  return { node: found.node, path: found.path, version }
}

async function collectStream(call, options) {
  let text = ''
  let blockText = ''
  let usage = null
  let finish = null
  for await (const chunk of call.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') blockText += chunk.block.text
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  // 少数适配器只在 block-end 给完整文本，没有 text-delta；两种形态都兜住。
  const output = text || blockText
  if (!finish) throw new Error('模型没有返回结束原因（输出被中断）。')
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`模型调用失败：${finish.failure?.message || finish.kind}`)
  }
  if (finish.kind === 'max-tokens') throw new Error('复盘输出超过 token 上限被截断。')
  if (finish.kind !== 'stop') throw new Error(`模型输出未正常结束：${finish.kind}`)
  return { text: output, usage }
}

async function streamOnce(ctx, node, path, version, previousReview, attempt, signal, external) {
  const selectionService = ctx.get('agentDefaultModel')
  const selection = selectionService && typeof selectionService.currentSelection === 'function'
    ? selectionService.currentSelection()
    : null
  if (!selection || !selection.provider || !selection.model) {
    throw new Error('找不到可用的默认模型（agentDefaultModel 服务缺席或未配置）。')
  }
  const llm = ctx.get('llm')
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('LLM 服务不可用（llm 服务缺席）。')

  const request = buildReviewRequest(node, path, version, previousReview, attempt, external)
  const call = await llm.prepareCall({
    provider: selection.provider,
    model: selection.model,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }, signal)
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
    system: request.system,
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  }
  const { text, usage } = await collectStream(call, options)
  return { text, usage, model: `${selection.provider}/${selection.model}` }
}

// 执行一次复盘（异步）。成功返回 {review,status}；失败抛错，由 queueReview 落盘。
export async function runReview(ctx, nodeId, submissionId, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const maxAttempts = options.maxAttempts || DEFAULT_ATTEMPTS
  const started = Date.now()
  const job = running.get(nodeId)
  const jobSignal = job && job.submissionId === submissionId ? job.controller.signal : null

  // 整体截止时间：所有尝试共享，避免“重试一次 = 两倍等待”。
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new Error(`复盘超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs)
  const onExternalAbort = () => deadline.abort(jobSignal?.reason || new Error('复盘被取消'))
  if (jobSignal) {
    if (jobSignal.aborted) deadline.abort(jobSignal.reason)
    else jobSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  let lastError = null
  let external = { ran: false, queries: [], sources: [], error: null }
  try {
    const current = readCurrent(nodeId, submissionId)
    external = await collectExternalEvidence(ctx, current.node, current.version, deadline.signal)
  } catch (err) {
    external = { ran: false, queries: [], sources: [], error: String(err?.message || err) }
  }
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (deadline.signal.aborted) break
      const { node, path, version } = readCurrent(nodeId, submissionId)
      const previousReview = listReviews()
        .filter((review) => review.node_id === nodeId && review.version < version.version)
        .at(-1) || null
      let output
      try {
        output = await streamOnce(ctx, node, path, version, previousReview, attempt, deadline.signal, external)
      } catch (err) {
        lastError = err
        continue
      }
      try {
        const parsed = parseReviewJson(output.text)
        return applyReview({
          node_id: nodeId,
          submission_id: submissionId,
          dimensions: parsed.dimensions,
          next_actions: parsed.next_actions,
          evidence_refs: external.sources,
          external_check: {
            ran: external.ran,
            queries: external.queries,
            error: external.error,
            checked_at: nowIso(),
          },
          source: 'ai',
          model: output.model,
          usage: output.usage,
          attempts: attempt,
          elapsed_ms: Date.now() - started,
        })
      } catch (err) {
        lastError = err
        const message = String(err && err.message ? err.message : err)
        appendAudit({ action: 'review_attempt_failed', node_id: nodeId, version: version.version, attempt, reason: message })
      }
    }
  } finally {
    clearTimeout(timer)
    if (jobSignal) jobSignal.removeEventListener('abort', onExternalAbort)
  }
  // 超时/取消时保留中文原因，而不是适配器的英文 abort 文案。
  if (deadline.signal.aborted) {
    const reason = deadline.signal.reason
    throw reason instanceof Error ? reason : new Error('复盘被取消')
  }
  throw lastError || new Error('复盘失败：未知原因')
}

// 提交后调用：设置运行态、启动异步复盘、失败写回版本。同一节点只允许一个复盘任务。
// 硬超时兜底：即使适配器忽略 abort，running 也一定会被清理并落失败，界面不会永久转圈。
export function queueReview(ctx, nodeId, submissionId, options = {}) {
  if (running.has(nodeId)) return false
  const controller = new AbortController()
  const job = { submissionId, startedAt: nowIso(), controller, superseded: false }
  running.set(nodeId, job)
  appendAudit({ action: 'review_started', node_id: nodeId, submission_id: submissionId })
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const hardTimeout = timeoutMs + 15_000
  ;(async () => {
    let hardTimer = null
    try {
      const hardStop = new Promise((_, reject) => {
        hardTimer = setTimeout(() => reject(new Error(`复盘超时（${Math.round(hardTimeout / 1000)} 秒），已强制结束`)), hardTimeout)
      })
      await Promise.race([runReview(ctx, nodeId, submissionId, { ...options, signal: controller.signal }), hardStop])
    } catch (err) {
      if (job.superseded) return
      const message = String(err && err.message ? err.message : err)
      try {
        recordReviewFailure(nodeId, submissionId, message)
      } catch (inner) {
        appendAudit({ action: 'review_failed', node_id: nodeId, reason: `写入失败：${inner.message}` })
      }
    } finally {
      if (hardTimer) clearTimeout(hardTimer)
      if (running.get(nodeId) === job) running.delete(nodeId)
    }
  })()
  return true
}

export function retryReview(ctx, nodeId, options = {}) {
  const target = retryableReviewNode(nodeId)
  const existing = running.get(nodeId)
  if (existing) {
    if (!options.force) throw new Blocked('这个节点正在复盘，请稍候。')
    // 强制重试：先作废旧任务（它不再写失败、也不会误删新任务的 running 标记）。
    existing.superseded = true
    try { existing.controller.abort(new Error('用户取消了上一次复盘')) } catch {}
    running.delete(nodeId)
  }
  return queueReview(ctx, nodeId, target.submission_id)
}
