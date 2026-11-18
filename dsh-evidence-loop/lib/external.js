// 证据回路 · 外部事实校验。
//
// 只对标记了 external_check 的节点执行：调用 Host 的 web.search（与 web_search 工具同一个服务面），
// 结果作为「辅助证据」注入复盘提示并写入 evidence_refs；检索失败不阻断复盘，只在复盘里记原因。
import { appendAudit } from './store.js'

const MAX_QUERIES = 2
const MAX_RESULTS = 3
const MAX_TOTAL = 6
const SEARCH_TIMEOUT_MS = 8_000

export function nodeNeedsExternalCheck(node) {
  return node?.external_check === true
}

export function buildQueries(node, version) {
  const queries = []
  const title = String(node?.title || '').split(/[：:]/)[0].trim()
  if (title) queries.push(title)
  // 只把节点自己的证据要求当检索词，不发送交付物正文，避免把学习内容带到搜索服务。
  const requirement = String(node?.evidence_required || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (requirement && requirement !== title) queries.push(requirement)
  return [...new Set(queries)].slice(0, MAX_QUERIES)
}

function normalizeSource(source, query) {
  if (!source || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url)) return null
  return {
    query,
    url: source.url.slice(0, 500),
    title: String(source.title || '').slice(0, 160),
    snippet: String(source.snippet || source.summary || '').replace(/\s+/g, ' ').slice(0, 240),
    published_at: source.publishedAt ? String(source.publishedAt).slice(0, 40) : null,
  }
}

// 返回 {ran, queries, sources, error}。ran=false 表示这个节点不需要外部校验或服务不可用。
export async function collectExternalEvidence(ctx, node, version, signal, options = {}) {
  const queries = buildQueries(node, version)
  if (!nodeNeedsExternalCheck(node)) return { ran: false, queries: [], sources: [], error: null }

  const web = ctx.get('web')
  if (!web || typeof web.search !== 'function') {
    return { ran: false, queries, sources: [], error: '联网检索服务不可用（web 服务缺席）' }
  }

  const sources = []
  const errors = []
  for (const query of queries) {
    const timeout = AbortSignal.timeout(options.timeoutMs || SEARCH_TIMEOUT_MS)
    const searchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const result = await web.search({ query, maxResults: MAX_RESULTS }, searchSignal)
      for (const source of result?.sources || []) {
        const normalized = normalizeSource(source, query)
        if (normalized) sources.push(normalized)
      }
    } catch (err) {
      errors.push(`${query}：${err?.message || String(err)}`)
    }
  }

  const seen = new Set()
  const deduped = []
  for (const source of sources) {
    if (seen.has(source.url)) continue
    seen.add(source.url)
    deduped.push(source)
  }

  const result = {
    ran: true,
    queries,
    sources: deduped.slice(0, MAX_TOTAL),
    error: errors.length ? errors.join('；') : null,
  }
  appendAudit({
    action: 'external_check',
    node_id: node.node_id,
    queries: result.queries,
    sources: result.sources.length,
    error: result.error,
  })
  return result
}
