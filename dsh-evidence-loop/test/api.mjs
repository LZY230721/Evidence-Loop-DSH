// 路由自测：真实 HTTP 打 /evidence-loop/api/*，并用假的 LLM 流验证「提交即复盘 → 状态自动流转」。
import assert from 'node:assert/strict'
import http from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { registerApi } from '../lib/api.js'

assert.ok(process.env.DSH_HOME && process.env.DSH_HOME.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录')
rmSync(join(process.env.DSH_HOME, 'evidence-loop'), { recursive: true, force: true })

const V1 = '概念 X 的定义：它是把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。反例：两个信号彼此独立时，合并会丢掉信息。'
const V2 = '概念 X 的定义来自《认知科学导论》p.42：把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。新增边界案例：两个信号彼此独立时合并会丢掉信息。'
const q = (text) => `「${text}」`

const PASS_A1 = JSON.stringify({
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `定义清楚 ${q('把两个独立信号合并成一个判断的机制')}。` },
    { name: '证据充分性', verdict: '通过', reason: `例子可核查 ${q('红绿灯把亮灯与通行合并')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `顺序可读 ${q('反例：两个信号彼此独立时')}。` },
  ],
  next_actions: [{ text: '用同一套证据结构推进 A2。', node_id: 'A2' }],
})

const FAIL_A2 = JSON.stringify({
  dimensions: [
    { name: '完成度', verdict: '部分通过', reason: `只写了定义 ${q('把两个独立信号合并成一个判断的机制')}，边界缺失。` },
    { name: '证据充分性', verdict: '不通过', reason: `没有来源 ${q('红绿灯把亮灯与通行合并')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `顺序可读 ${q('反例：两个信号彼此独立时')}。` },
  ],
  next_actions: [{ text: '补齐来源后重做。', node_id: 'A2' }],
})

const PASS_A2_V2 = JSON.stringify({
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `补全了边界 ${q('新增边界案例')}。` },
    { name: '证据充分性', verdict: '通过', reason: `来源可核查 ${q('《认知科学导论》p.42')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `结构清楚 ${q('把两个独立信号合并成一个判断的机制')}。` },
    { name: '迭代痕迹', verdict: '通过', reason: `修改理由落实在 ${q('《认知科学导论》p.42')}。` },
  ],
  next_actions: [{ text: '推进 A3。', node_id: 'A3' }],
})

const script = [PASS_A1, FAIL_A2, PASS_A2_V2]
let callIndex = 0
const fakeLlm = {
  async prepareCall(config) {
    return {
      config,
      async *stream(options) {
        if (String(options.system || '').includes('耐心的 AI 导师')) {
          yield { type: 'text-delta', text: '先把节点要求拆成三步，再告诉我你卡在哪一步。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const text = script[Math.min(callIndex, script.length - 1)]
        callIndex += 1
        yield { type: 'text-delta', text }
        yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 120 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  },
}

let route
let shareOptions = null
let shareMode = 'good'
let revokedShare = null
const ctx = {
  get(name) {
    if (name === 'llm') return fakeLlm
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake-review' }) }
    if (name === 'shareLink') {
      return {
        async createPathShare(path, options) {
          shareOptions = { path, options }
          if (shareMode === 'bad') {
            return { url: 'https://api.trycloudflare.com/s/abc123/', id: 'bad-entry', expiresAt: Date.now() + 3600_000, provider: 'tunnel' }
          }
          return { url: 'https://share.example.test/s/abc123', id: 'abc123', expiresAt: Date.now() + 3600_000, provider: 'tunnel' }
        },
        async revoke(id) {
          revokedShare = id
          return true
        },
      }
    }
    return undefined
  },
  webServer: { register(candidate) { route = candidate; return () => {} } },
}
registerApi(ctx)
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/evidence-loop')

const server = http.createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const call = async (path, method = 'GET', body, headers = {}) => {
  const res = await fetch(base + '/evidence-loop' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json() }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (predicate, label, timeout = 6000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const payload = await call('/api/state')
    if (predicate(payload.json)) return payload.json
    await sleep(60)
  }
  throw new Error(`等待超时：${label}`)
}

const nodeOf = (state, nodeId) => state.paths.flatMap((path) => path.nodes).find((node) => node.node_id === nodeId)

try {
  const state = await call('/api/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.stats.total, 14)
  assert.equal(state.json.api_version, 4, '状态投影需带协议版本，供面板检测旧宿主')
  assert.equal(state.json.focus.node_id, 'A1')

  const missing = await call('/api/start', 'POST', {})
  assert.equal(missing.status, 409)
  assert.match(missing.json.error, /没有这个学习节点/)

  const started = await call('/api/start', 'POST', { nodeId: 'A1' })
  assert.equal(started.status, 200)
  assert.equal(nodeOf(started.json.state, 'A1').status, '练习中')

  const submitted = await call('/api/submit', 'POST', { nodeId: 'A1', content: V1 })
  assert.equal(submitted.status, 200)
  assert.equal(submitted.json.submission.version, 1)
  assert.equal(nodeOf(submitted.json.state, 'A1').status, '已提交')
  assert.equal(nodeOf(submitted.json.state, 'A1').review_state, 'running', '提交应立即进入复盘运行态')

  const a1Passed = await waitFor((s) => nodeOf(s, 'A1').status === '已通过复盘', 'A1 复盘通过')
  assert.equal(a1Passed.stats.passed, 1)
  assert.equal(nodeOf(a1Passed, 'A1').versions[0].review.dimensions.length, 3)
  assert.equal(a1Passed.focus.node_id, 'A2')

  await call('/api/start', 'POST', { nodeId: 'A2' })
  await call('/api/submit', 'POST', { nodeId: 'A2', content: V1 })
  const a2Rework = await waitFor((s) => nodeOf(s, 'A2').status === '需重做', 'A2 判定需重做')
  assert.equal(nodeOf(a2Rework, 'A2').versions[0].review.dimensions.length, 3)

  const noReason = await call('/api/submit', 'POST', { nodeId: 'A2', content: V2 })
  assert.equal(noReason.status, 409)
  assert.equal(noReason.json.blocked, true)
  assert.match(noReason.json.error, /修改理由/)
  assert.ok(noReason.json.state, '拦截响应应带最新 state')
  assert.equal(nodeOf(noReason.json.state, 'A2').status, '需重做', '被拦截后状态不变')

  const withReason = await call('/api/submit', 'POST', {
    nodeId: 'A2', content: V2, reworkReason: '补上来源页码并重写反例。',
  })
  assert.equal(withReason.status, 200)
  assert.equal(withReason.json.submission.version, 2)
  assert.equal(withReason.json.submission.rework, true)

  const a2Passed = await waitFor((s) => nodeOf(s, 'A2').status === '已通过复盘', 'A2 重做后通过')
  assert.equal(nodeOf(a2Passed, 'A2').versions[1].review.dimensions.length, 4)

  // 模拟复盘入口必须已经不存在（404，不是 410 之类的兼容保留）
  const legacy = await call('/api/mock-review', 'POST', { nodeId: 'A1', mode: 'pass' })
  assert.equal(legacy.status, 404)

  // 审计台数据
  const audit = await call('/api/audit')
  assert.equal(audit.status, 200)
  assert.equal(audit.json.summary.reviews, 3)
  assert.equal(audit.json.summary.rework_total, 1)
  assert.equal(audit.json.hotspots.length, 1)
  assert.equal(audit.json.hotspots[0].node_id, 'A2')
  assert.equal(audit.json.hotspots[0].rework_count, 1)
  assert.equal(audit.json.next_actions[0].target_node_id, 'A3', '最近写入的待办排在最前')
  assert.ok(audit.json.next_actions.some((item) => item.target_node_id === 'A2'))
  assert.equal(audit.json.series.length, 3)
  const a1Series = audit.json.series.find((point) => point.node_id === 'A1')
  assert.equal(a1Series.values['完成度'], 3)
  const a2v2Series = audit.json.series.find((point) => point.node_id === 'A2' && point.version === 2)
  assert.equal(a2v2Series.values['迭代痕迹'], 3, '重做提交应有迭代痕迹')
  assert.ok(audit.json.events.some((event) => event.rework), '时间线应标记重做事件')

  assert.equal((await call('/api/nope')).status, 404)
  assert.equal((await call('/api/start')).status, 405)
  const badOrigin = await call('/api/start', 'POST', { nodeId: 'A3' }, { origin: 'http://evil.example' })
  assert.equal(badOrigin.status, 403)

  // 重新复盘：对已通过的节点应被拒绝
  const rejectRetry = await call('/api/review', 'POST', { nodeId: 'A1' })
  assert.equal(rejectRetry.status, 409)

  // 分享页：保存心得 → 预览 → 生成并发布（不传 channel）
  const noteSave = await call('/api/share/note', 'POST', { note: '我学到：先补来源，再下结论。' })
  assert.equal(noteSave.status, 200)
  assert.equal(noteSave.json.note, '我学到：先补来源，再下结论。')
  assert.equal((await call('/api/share/note')).json.note, '我学到：先补来源，再下结论。')

  const preview = await call('/api/share/preview')
  assert.equal(preview.status, 200)
  assert.equal(preview.json.key_events, 1)
  assert.equal(preview.json.badcases, 1)
  assert.equal(preview.json.last_publish, null, '首次生成前没有上次发布')

  const built = await call('/api/share/build', 'POST', { ttlHours: 168 })
  assert.equal(built.status, 200)
  assert.match(built.json.path, /share[\\/]evidence-loop-.*\.html$/)
  assert.equal(built.json.publish.url, 'https://share.example.test/s/abc123')
  assert.ok(shareOptions, '应调用 shareLink.createPathShare')
  assert.equal(shareOptions.options.ttlHours, 168)
  assert.equal('channel' in shareOptions.options, false, '发布时不得传 channel')

  const { readFileSync } = await import('node:fs')
  const html = readFileSync(built.json.path, 'utf8')
  assert.match(html, /我的学习证据台账/)
  assert.match(html, /我学到：先补来源，再下结论。/)
  assert.match(html, /A2/)

  const previewAfter = await call('/api/share/preview')
  assert.equal(previewAfter.json.last_publish.url, 'https://share.example.test/s/abc123')
  assert.equal(previewAfter.json.last_publish.id, 'abc123', '上次发布应能取回撤销 id')

  // 本机预览：同源 HTML 能直接打开，且挡住目录穿越与非 HTML
  const raw = async (suffix) => {
    const res = await fetch(base + '/evidence-loop' + suffix)
    return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() }
  }
  const fileName = built.json.local_path.split('/').pop()
  const local = await raw('/share/' + fileName)
  assert.equal(local.status, 200)
  assert.match(local.type, /text\/html/)
  assert.match(local.text, /我的学习证据台账/)
  assert.equal((await raw('/share/..%2Fpaths.json')).status, 404)
  assert.equal((await raw('/share/nope.html')).status, 404)

  // 上游把 API 主机当隧道地址：接口必须返回发布失败，而不是坏链接
  shareMode = 'bad'
  const badBuild = await call('/api/share/build', 'POST', { ttlHours: 1 })
  assert.equal(badBuild.status, 200)
  assert.equal(badBuild.json.publish, null)
  assert.match(badBuild.json.publish_error, /无效地址/)
  assert.equal(revokedShare, 'bad-entry')
  shareMode = 'good'

  // 呼叫教练：空历史 → 发一条 → 读回 → 清空；未知节点 404
  const chatEmpty = await call('/api/chat?nodeId=A1')
  assert.equal(chatEmpty.status, 200)
  assert.deepEqual(chatEmpty.json.messages, [])

  const chatSend = await call('/api/chat', 'POST', { nodeId: 'A1', message: '第一步该做什么？' })
  assert.equal(chatSend.status, 200)
  assert.match(chatSend.json.reply, /拆成三步/)
  assert.equal(chatSend.json.messages.length, 2)

  const chatBack = await call('/api/chat?nodeId=A1')
  assert.equal(chatBack.json.messages.length, 2)
  assert.equal(chatBack.json.messages[0].content, '第一步该做什么？')

  const chatReset = await call('/api/chat/reset', 'POST', { nodeId: 'A1' })
  assert.equal(chatReset.status, 200)
  assert.deepEqual(chatReset.json.messages, [])
  assert.equal((await call('/api/chat?nodeId=Z9')).status, 404)

  console.log('API OK', { reviews: audit.json.summary.reviews, focus: a2Passed.focus.node_id, llmCalls: callIndex, share: built.json.publish.url })
} finally {
  await new Promise((resolve) => server.close(resolve))
}
