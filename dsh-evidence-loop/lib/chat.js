// 证据回路 · 呼叫教练（节点上下文内的多轮对话）。
//
// 教练只给提示与排查方向，不代写作业；对话按节点落在 ~/.dsh/evidence-loop/chat/<node_id>.json。
// 历史以「对话记录」形式折叠进当前 user 消息，避免依赖 assistant 消息的完整结构，兼容所有适配器。
import { join } from 'node:path'
import { CHAT_DIR, appendAudit, findNode, loadPaths, nowIso, readJson, writeJson } from './store.js'

export const COACH_SYSTEM_PROMPT = '你是一个耐心的 AI 导师，专门辅导文科生转行 AI。只给提示和排查方向，绝对不要直接替我完成作业，也不要直接给答案。'

const MAX_MESSAGE_CHARS = 2000
const MAX_STORED_MESSAGES = 200
const HISTORY_TURNS = 12
const MAX_OUTPUT_TOKENS = 1400
const TIMEOUT_MS = 60_000

const running = new Set()

export function chatFilePath(nodeId) {
  return join(CHAT_DIR, `${nodeId}.json`)
}

function requireNode(nodeId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(nodeId || ''))) {
    throw Object.assign(new Error(`非法的节点 ID：${nodeId || '(空)'}`), { status: 400 })
  }
  const data = loadPaths()
  const found = findNode(data, nodeId)
  if (!found) throw Object.assign(new Error(`没有这个学习节点：${nodeId || '(空)'}`), { status: 404 })
  return found.node
}

function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map((message) => ({
      role: message.role,
      content: String(message.content).slice(0, 8000),
      at: message.at || null,
    }))
    .slice(-MAX_STORED_MESSAGES)
}

export function readChat(nodeId) {
  requireNode(nodeId)
  const record = readJson(chatFilePath(nodeId), null)
  return {
    node_id: nodeId,
    updated_at: record?.updated_at || null,
    messages: normalizeMessages(record?.messages),
  }
}

export function resetChat(nodeId) {
  requireNode(nodeId)
  if (running.has(nodeId)) throw Object.assign(new Error('教练正在回复，请稍后再清空。'), { status: 429 })
  const record = { node_id: nodeId, updated_at: nowIso(), messages: [] }
  writeJson(chatFilePath(nodeId), record)
  return record
}

async function callCoach(ctx, selection, transcript) {
  const llm = ctx.get('llm')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('教练响应超时（60 秒）')), TIMEOUT_MS)
  try {
    const call = await llm.prepareCall({
      provider: selection.provider,
      model: selection.model,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.7,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }, controller.signal)
    const options = {
      ...call.config,
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: transcript }] }],
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: controller.signal,
    }
    let text = ''
    let blockText = ''
    let finish = null
    for await (const chunk of call.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (!finish) throw new Error('教练没有返回结束原因，请重试。')
    if (finish.kind === 'max-tokens') throw new Error('教练回复被截断，把问题说得更具体一点再试。')
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error('教练调用失败或被中断，请重试。')
    if (finish.kind !== 'stop') throw new Error('教练没有正常回复，请重试。')
    const reply = (text || blockText).trim()
    if (!reply) throw new Error('教练没有给出内容，请重试。')
    return reply
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('教练响应超时（60 秒），请重试。'), { status: 504 })
    throw Object.assign(error, { status: error.status || 502 })
  } finally {
    clearTimeout(timer)
  }
}

export async function sendChat(ctx, nodeId, message) {
  const node = requireNode(nodeId)
  const text = String(message || '').trim()
  if (!text) throw Object.assign(new Error('消息为空。'), { status: 400 })
  if (text.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error(`消息太长（${text.length} 字），请控制在 ${MAX_MESSAGE_CHARS} 字内。`), { status: 400 })
  if (running.has(nodeId)) throw Object.assign(new Error('教练正在回复上一条，请稍候。'), { status: 429 })

  const selectionService = ctx.get('agentDefaultModel')
  const selection = selectionService && typeof selectionService.currentSelection === 'function'
    ? selectionService.currentSelection()
    : null
  if (!selection || !selection.provider || !selection.model) {
    throw Object.assign(new Error('找不到可用的默认模型（agentDefaultModel 服务缺席或未配置）。'), { status: 503 })
  }
  const llm = ctx.get('llm')
  if (!llm || typeof llm.prepareCall !== 'function') {
    throw Object.assign(new Error('LLM 服务不可用（llm 服务缺席）。'), { status: 503 })
  }

  const existing = readChat(nodeId)
  const history = existing.messages
  const historyUpdatedAt = existing.updated_at
  const historyText = history
    .slice(-HISTORY_TURNS)
    .map((item) => `${item.role === 'user' ? '学习者' : '教练'}：${item.content}`)
    .join('\n')
    .slice(-6000)
  const transcript = [
    `【当前节点】${node.node_id} ${node.title}`,
    `【节点状态】${node.status}`,
    `【通过本节点需要的证据】${node.evidence_required}`,
    node.tutorial ? `【节点实操指南】${node.tutorial}` : '',
    historyText ? `【对话历史】\n${historyText}` : '',
    `【学习者】${text}`,
  ].filter(Boolean).join('\n')

  running.add(nodeId)
  let hardTimer = null
  try {
    // 硬超时兜底：即使适配器忽略 abort，也不会永久锁死这个节点的教练对话。
    const hardStop = new Promise((_, reject) => {
      hardTimer = setTimeout(() => {
        reject(Object.assign(new Error('教练响应超时（75 秒），请重试。'), { status: 504 }))
      }, TIMEOUT_MS + 15_000)
    })
    const reply = await Promise.race([callCoach(ctx, selection, transcript), hardStop])
    const now = nowIso()
    const userRecord = { role: 'user', content: text, at: now }
    const assistantRecord = { role: 'assistant', content: reply, at: now }
    // 若等待期间对话被清空/被改写，不把旧历史整份写回（避免“清空又复活”）。
    const current = readJson(chatFilePath(nodeId), null)
    const sameGeneration = (current?.updated_at || null) === historyUpdatedAt
    const base = sameGeneration ? history : []
    const messages = [...base, userRecord, assistantRecord].slice(-MAX_STORED_MESSAGES)
    writeJson(chatFilePath(nodeId), { node_id: nodeId, updated_at: now, messages })
    appendAudit({ action: 'coach_message', node_id: nodeId, chars: text.length, reply_chars: reply.length })
    return { node_id: nodeId, updated_at: now, messages, reply }
  } finally {
    if (hardTimer) clearTimeout(hardTimer)
    running.delete(nodeId)
  }
}
