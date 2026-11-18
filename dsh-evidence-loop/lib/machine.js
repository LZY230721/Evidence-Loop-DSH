// 证据回路 · 状态机（硬编码）。
//
// 状态流转只允许以下四条，任何其他组合都会被拒绝并写入 audit-log：
//   未开始 --start--> 练习中
//   练习中 --submit--> 已提交
//   已提交 --review(all 通过 + 原文引用)--> 已通过复盘
//   已提交 --review(其余)--> 需重做
//   需重做 --submit(必须带 rework_reason)--> 已提交
//
// LLM 只能产出复盘 JSON，不能改状态：applyReview 校验失败时节点停在「已提交」。
import {
  appendAudit, findNode, loadPaths, newReviewId, newSubmissionId,
  nowIso, savePaths, saveReview, saveReworkReason, saveSubmission, summarize, touchStreak,
} from './store.js'

export const VERDICTS = ['通过', '部分通过', '不通过']
export const BASE_DIMENSIONS = ['完成度', '证据充分性', '结构清晰度']
export const REWORK_DIMENSION = '迭代痕迹'
export const MIN_CONTENT_CHARS = 10
export const MIN_REASON_CHARS = 5

export class Blocked extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'Blocked'
    this.status = 409
    this.details = details
  }
}

const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim()

// 外部证据只信插件自己检索到的来源，不接受模型在 JSON 里自填的 URL；只保留 http(s)。
function normalizeRefs(refs) {
  if (!Array.isArray(refs)) return []
  return refs.slice(0, 8)
    .map((ref) => ({
      query: String(ref?.query || '').slice(0, 200),
      url: String(ref?.url || '').slice(0, 500),
      title: String(ref?.title || '').slice(0, 160),
      snippet: String(ref?.snippet || '').slice(0, 240),
      ...(ref?.published_at ? { published_at: String(ref.published_at).slice(0, 40) } : {}),
    }))
    .filter((ref) => /^https?:\/\//i.test(ref.url))
}

export function extractQuotes(reason) {
  const out = []
  const source = String(reason || '')
  const pattern = /["“「『]([^"”」』]{4,})["”」』]/g
  let match
  while ((match = pattern.exec(source))) out.push(normalize(match[1]))
  return out.filter(Boolean)
}

function quoteAppears(quote, content) {
  return normalize(content).includes(quote)
}

function reject(data, node, reason, details = {}) {
  appendAudit({
    action: 'blocked',
    node_id: node?.node_id || details.node_id || null,
    status: node?.status || null,
    reason,
    attempt: details.attempt || 'route',
  })
  throw new Blocked(reason, details)
}

// ── 开始练习 ───────────────────────────────────────────────────────────
export function startNode(nodeId) {
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) reject(data, null, `没有这个学习节点：${nodeId || '(空)'}`, { node_id: nodeId })
  const { node } = found
  if (node.status !== '未开始') {
    reject(data, node, `「${node.node_id} ${node.title}」当前是「${node.status}」，只有「未开始」的节点可以开始。`, { attempt: 'start' })
  }
  node.status = '练习中'
  node.started_at = nowIso()
  node.updated_at = node.started_at
  savePaths(data)
  appendAudit({ action: 'status_change', node_id: node.node_id, from: '未开始', to: '练习中', trigger: 'start' })
  return node
}

// ── 提交版本（重做必须带理由）──────────────────────────────────────────
export function submitVersion(nodeId, content, reworkReason) {
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) reject(data, null, `没有这个学习节点：${nodeId || '(空)'}`, { node_id: nodeId })
  const { node } = found

  const text = String(content || '')
  if (!normalize(text)) reject(data, node, '交付物内容为空，无法提交。', { attempt: 'submit', field: 'content' })
  if (normalize(text).length < MIN_CONTENT_CHARS) {
    reject(data, node, `交付物太短（${normalize(text).length} 字），至少 ${MIN_CONTENT_CHARS} 字才能作为证据提交。`, { attempt: 'submit', field: 'content' })
  }

  const isRework = node.status === '需重做'
  if (node.status !== '练习中' && !isRework) {
    reject(data, node, `「${node.node_id} ${node.title}」当前是「${node.status}」，只有「练习中」或「需重做」的节点可以提交。`, { attempt: 'submit' })
  }

  const reason = String(reworkReason || '').trim()
  if (isRework && reason.length < MIN_REASON_CHARS) {
    // 规格要求：重做提交必须填写修改理由，否则提交按钮禁用；后端同样拦截。
    reject(data, node, '重做提交必须填写修改理由（rework_reason），否则无法提交。', { attempt: 'submit', field: 'rework_reason' })
  }

  const version = node.versions.length + 1
  const submission_id = newSubmissionId()
  const submitted_at = nowIso()
  const previous = node.versions.length ? node.versions[node.versions.length - 1] : null
  const record = {
    submission_id,
    node_id: node.node_id,
    path_id: found.path.path_id,
    version,
    content: text,
    summary: summarize(text),
    chars: normalize(text).length,
    word_count: (text.match(/\S+/g) || []).length,
    submitted_at,
    prev_submission_id: previous ? previous.submission_id : null,
    rework_reason: isRework ? reason : null,
    review_id: null,
    review_decision: null,
  }
  saveSubmission(record)
  if (isRework) {
    saveReworkReason({
      submission_id,
      node_id: node.node_id,
      path_id: found.path.path_id,
      version,
      rework_reason: reason,
      reworked_from_version: previous ? previous.version : null,
      created_at: submitted_at,
    })
  }

  const from = node.status
  node.versions.push({
    version,
    submission_id,
    submitted_at,
    summary: record.summary,
    chars: record.chars,
    content: text,
    review_id: null,
    review_decision: null,
    review_status: 'queued',
    review_error: null,
    rework_reason: record.rework_reason,
    prev_submission_id: record.prev_submission_id,
  })
  node.status = '已提交'
  node.updated_at = submitted_at
  node.next_actions = []
  touchStreak(data)
  savePaths(data)
  appendAudit({
    action: 'status_change',
    node_id: node.node_id,
    from,
    to: '已提交',
    trigger: isRework ? 'resubmit' : 'submit',
    submission_id,
    version,
    rework_reason: isRework ? reason : null,
  })
  return { node, submission: record, rework: isRework }
}

// ── 复盘裁决（插件代码算状态，LLM 只给判定）──────────────────────────────
// 校验失败：节点停在「已提交」，复盘不落盘，审计日志记录拦截原因。
export function applyReview(raw) {
  const data = loadPaths()
  const nodeId = raw?.node_id
  const found = findNode(data, nodeId)
  if (!found) reject(data, null, `复盘指向的节点不存在：${nodeId || '(空)'}`, { node_id: nodeId })

  const { node } = found
  if (node.status !== '已提交') {
    reject(data, node, `「${node.node_id}」当前是「${node.status}」，只有「已提交」的节点可以复盘。`, { attempt: 'review' })
  }
  const current = node.versions[node.versions.length - 1]
  if (!current) reject(data, node, '节点没有提交版本，不能复盘。', { attempt: 'review' })

  const version = current.version
  if (raw.submission_id && raw.submission_id !== current.submission_id) {
    reject(data, node, `复盘针对的提交 ${raw.submission_id} 不是当前版本 v${version}。`, { attempt: 'review' })
  }

  const required = version > 1 ? [...BASE_DIMENSIONS, REWORK_DIMENSION] : BASE_DIMENSIONS
  const dims = Array.isArray(raw.dimensions) ? raw.dimensions : []
  const byName = new Map()
  for (const dim of dims) {
    const name = String(dim?.name || '').trim()
    if (!name) continue
    if (byName.has(name)) reject(data, node, `复盘维度重复：${name}`, { attempt: 'review' })
    byName.set(name, dim)
  }
  const missing = required.filter((name) => !byName.has(name))
  if (missing.length) {
    reject(data, node, `复盘缺少必需维度：${missing.join('、')}（版本 v${version} 要求 ${required.join('、')}）。`, { attempt: 'review' })
  }

  const invalidQuotes = []
  const normalized = []
  for (const name of required) {
    const dim = byName.get(name)
    const verdict = String(dim?.verdict || '').trim()
    const reason = String(dim?.reason || '').trim()
    if (!VERDICTS.includes(verdict)) {
      reject(data, node, `维度「${name}」的判定必须是 通过/部分通过/不通过 之一，收到「${verdict || '(空)'}」。`, { attempt: 'review' })
    }
    if (reason.length < 8) {
      reject(data, node, `维度「${name}」缺少判断理由。`, { attempt: 'review' })
    }
    const quotes = extractQuotes(reason)
    const hit = quotes.find((quote) => quoteAppears(quote, current.content))
    if (!hit) invalidQuotes.push({ name, quotes })
    normalized.push({ name, verdict, reason, quote: hit || null })
  }
  if (invalidQuotes.length) {
    // 强引用：理由必须用引号引用交付物里的原文。校验不过就不落盘、不改状态。
    appendAudit({
      action: 'review_rejected',
      node_id: node.node_id,
      version,
      reason: '复盘理由没有引用交付物原文',
      dimensions: invalidQuotes.map((item) => item.name),
    })
    throw new Blocked(`复盘被拒绝：维度 ${invalidQuotes.map((item) => `「${item.name}」`).join('、')} 的理由没有引用交付物原文。`, {
      details: { invalidQuotes },
    })
  }

  const actions = Array.isArray(raw.next_actions) ? raw.next_actions : []
  if (actions.length < 1 || actions.length > 2) {
    reject(data, node, `next_actions 必须是 1-2 条，收到 ${actions.length} 条。`, { attempt: 'review' })
  }
  const nextActions = actions.map((action) => {
    const text = String(typeof action === 'string' ? action : action?.text || '').trim()
    if (!text) reject(data, node, 'next_actions 里有一条动作没有内容。', { attempt: 'review' })
    if (typeof action === 'object' && action?.node_id) {
      if (!findNode(data, action.node_id)) reject(data, node, `next_actions 指向了不存在的节点：${action.node_id}`, { attempt: 'review' })
      return { text, node_id: action.node_id }
    }
    return { text }
  })

  const decision = normalized.every((dim) => dim.verdict === '通过') ? '已通过复盘' : '需重做'
  const review_id = newReviewId()
  const record = {
    review_id,
    node_id: node.node_id,
    path_id: found.path.path_id,
    submission_id: current.submission_id,
    version,
    decision,
    source: raw.source || 'ai',
    dimensions: normalized,
    next_actions: nextActions,
    evidence_refs: normalizeRefs(raw.evidence_refs),
    ...raw.external_check ? { external_check: raw.external_check } : {},
    ...raw.model ? { model: raw.model } : {},
    ...raw.usage ? { usage: raw.usage } : {},
    attempts: Number(raw.attempts) || 1,
    elapsed_ms: Number.isFinite(raw.elapsed_ms) ? raw.elapsed_ms : null,
    created_at: nowIso(),
  }
  saveReview(record)

  current.review_id = review_id
  current.review_decision = decision
  current.review_status = 'done'
  delete current.review_error
  delete current.review_failed_at
  node.updated_at = record.created_at
  node.next_actions = nextActions
  node.next_actions_at = record.created_at
  const from = node.status
  node.status = decision
  savePaths(data)
  appendAudit({
    action: 'review_applied',
    node_id: node.node_id,
    review_id,
    from,
    to: decision,
    version,
    verdicts: Object.fromEntries(normalized.map((dim) => [dim.name, dim.verdict])),
  })
  return { review: record, status: decision, node }
}

// ── 复盘失败 / 重新复盘 ────────────────────────────────────────────────
// 失败不改状态：节点停在「已提交」，错误写在当前版本上，界面显示原因与「重新复盘」。

export function retryableReviewNode(nodeId) {
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) throw new Blocked(`没有这个学习节点：${nodeId || '(空)'}`)
  const { node } = found
  if (node.status !== '已提交') {
    throw new Blocked(`「${node.node_id}」当前是「${node.status}」，只有「已提交」可以重新复盘。`)
  }
  const version = node.versions[node.versions.length - 1]
  if (!version) throw new Blocked('节点没有提交版本，不能复盘。')
  if (version.review_id) throw new Blocked('这个版本已经有复盘记录。')
  return version
}

export function recordReviewFailure(nodeId, submissionId, message) {
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) throw new Blocked(`没有这个学习节点：${nodeId || '(空)'}`)
  const { node } = found
  if (node.status !== '已提交') {
    appendAudit({ action: 'review_failed', node_id: node.node_id, reason: `节点已不在「已提交」（当前 ${node.status}），复盘作废` })
    return null
  }
  const current = node.versions[node.versions.length - 1]
  if (!current) return null
  if (submissionId && current.submission_id !== submissionId) {
    appendAudit({ action: 'review_failed', node_id: node.node_id, reason: '提交版本已变化，复盘作废' })
    return null
  }
  current.review_status = 'failed'
  current.review_error = String(message || '复盘失败').slice(0, 800)
  current.review_failed_at = nowIso()
  node.updated_at = current.review_failed_at
  savePaths(data)
  appendAudit({
    action: 'review_failed',
    node_id: node.node_id,
    version: current.version,
    reason: current.review_error,
  })
  return current
}