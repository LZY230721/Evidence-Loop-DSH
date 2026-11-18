// 外部事实校验自测：只对标记节点检索，结果写入 evidence_refs，失败不阻断复盘。
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { startNode, submitVersion } from '../lib/machine.js'
import { runReview } from '../lib/review.js'
import { buildState } from '../lib/state.js'
import { loadPaths } from '../lib/store.js'

assert.ok(process.env.DSH_HOME && process.env.DSH_HOME.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录')
rmSync(join(process.env.DSH_HOME, 'evidence-loop'), { recursive: true, force: true })

const CONTENT = '信息源台账：主张「提示词角色扮演能提升稳定性」来自 2024 年的一篇评测。接口文档写的是 temperature 默认 0.7。'
const q = (text) => `「${text}」`

const PASS = {
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `台账写到了 ${q('信息源台账：主张')}，覆盖来源字段。` },
    { name: '证据充分性', verdict: '通过', reason: `给出了日期与断言 ${q('2024 年的一篇评测')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `条目结构可读 ${q('接口文档写的是 temperature 默认 0.7')}。` },
  ],
  next_actions: [{ text: '继续补第二条来源。', node_id: 'B2' }],
}

let webCalls = 0
let webMode = 'ok'
const web = {
  async search(request) {
    webCalls += 1
    if (webMode === 'fail') throw new Error('搜索服务暂时不可用')
    return {
      sources: [
        { url: 'javascript:alert(1)', title: 'bad protocol' },
        { url: 'https://example.test/source-a', title: 'Source A', snippet: 'snippet a' },
        { url: 'https://example.test/source-b', title: 'Source B', snippet: 'snippet b' },
      ],
      truncated: false,
    }
  },
}

function fakeCtx(responses) {
  let index = 0
  const llm = {
    async prepareCall(config) {
      return {
        config,
        async *stream() {
          const text = responses[Math.min(index, responses.length - 1)]
          index += 1
          yield { type: 'text-delta', text }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake-review' }) }
      if (name === 'web') return web
      return undefined
    },
  }
}

const submissionOf = (nodeId) => {
  const node = buildState().paths.flatMap((path) => path.nodes).find((item) => item.node_id === nodeId)
  return node.versions[node.versions.length - 1].submission_id
}
const nodeOf = (nodeId) => buildState().paths.flatMap((path) => path.nodes).find((item) => item.node_id === nodeId)

// 1. 标记节点：检索两次查询 → 去重写入 evidence_refs
startNode('B1')
submitVersion('B1', CONTENT, '')
const b1 = await runReview(fakeCtx([JSON.stringify(PASS)]), 'B1', submissionOf('B1'))
assert.equal(b1.status, '已通过复盘')
assert.equal(webCalls, 2, '应发起 2 次检索（节点标题 + 提交摘要）')
assert.equal(b1.review.evidence_refs.length, 2, '同一批来源应去重')
assert.equal(b1.review.evidence_refs[0].url, 'https://example.test/source-a')
assert.equal(b1.review.evidence_refs.some((ref) => ref.url.startsWith('javascript:')), false, '非 http(s) 链接必须丢弃')
assert.equal(b1.review.external_check.ran, true)
assert.equal(b1.review.external_check.queries.length, 2)
assert.ok(buildState().audit.events.some((event) => event.action === 'external_check' && event.node_id === 'B1'))

// 2. 未标记节点：不触发检索
startNode('A1')
submitVersion('A1', CONTENT, '')
const a1 = await runReview(fakeCtx([JSON.stringify(PASS)]), 'A1', submissionOf('A1'))
assert.equal(a1.status, '已通过复盘')
assert.equal(webCalls, 2, '未标记 external_check 的节点不得检索')
assert.equal(a1.review.evidence_refs.length, 0)
assert.equal(a1.review.external_check.ran, false)

// 3. 检索失败：复盘继续，evidence_refs 为空并记录原因
webMode = 'fail'
startNode('B4')
submitVersion('B4', CONTENT, '')
const b4 = await runReview(fakeCtx([JSON.stringify(PASS)]), 'B4', submissionOf('B4'))
assert.equal(b4.status, '已通过复盘', '检索失败不应阻断复盘')
assert.equal(b4.review.evidence_refs.length, 0)
assert.match(b4.review.external_check.error, /搜索服务暂时不可用/)
assert.equal(nodeOf('B4').status, '已通过复盘')

console.log('EXTERNAL OK', { webCalls, b1Refs: b1.review.evidence_refs.length, b1Queries: b1.review.external_check.queries })
