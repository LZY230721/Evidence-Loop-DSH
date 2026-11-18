// 复盘引擎自测：用假的 llm 流覆盖 通过 / 引用缺失 / 重试 / 重做第 4 维 / 非法 JSON。
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { applyReview, recordReviewFailure, startNode, submitVersion } from '../lib/machine.js'
import { parseReviewJson, runReview } from '../lib/review.js'
import { buildState } from '../lib/state.js'
import { loadPaths, readAudit } from '../lib/store.js'

assert.ok(process.env.DSH_HOME && process.env.DSH_HOME.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录')
rmSync(join(process.env.DSH_HOME, 'evidence-loop'), { recursive: true, force: true })

const CONTENT = '概念 X 的定义：它是把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。反例：两个信号彼此独立时，合并会丢掉信息。'

const quote = (text) => `「${text}」`

const passReview = () => ({
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `交付物给出了定义 ${quote('把两个独立信号合并成一个判断的机制')}，覆盖要求。` },
    { name: '证据充分性', verdict: '通过', reason: `例子可以核查 ${quote('红绿灯把亮灯与通行合并')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `段落顺序清楚 ${quote('反例：两个信号彼此独立时')}。` },
  ],
  next_actions: [{ text: '把证据结构固化后推进 A2。', node_id: 'A2' }],
})

const noQuoteReview = () => ({
  dimensions: [
    { name: '完成度', verdict: '通过', reason: '交付物覆盖了节点要求的三段内容，结构完整。' },
    { name: '证据充分性', verdict: '通过', reason: '给出的例子具备可核查性，来源清楚。' },
    { name: '结构清晰度', verdict: '通过', reason: '段落顺序能读通，结论可以顺着找到。' },
  ],
  next_actions: [{ text: '继续下一个节点。' }],
})

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
          yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 180 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'fake', model: 'fake-review', reasoningEffort: 'high' }) }
      }
      return undefined
    },
  }
}

// 1. 源码里不再存在模拟复盘入口
{
  const machine = await import('../lib/machine.js')
  assert.equal(machine.mockReview, undefined, '阶段二必须删除 mockReview')
}

// 2. 首版：合法复盘（3 维）→ 已通过复盘，记录 model/usage/attempts
{
  startNode('A1')
  submitVersion('A1', CONTENT, '')
  const ctx = fakeCtx([JSON.stringify(passReview())])
  const result = await runReview(ctx, 'A1', loadPaths().paths[0].nodes[0].versions[0].submission_id)
  assert.equal(result.status, '已通过复盘')
  assert.equal(result.review.attempts, 1)
  assert.equal(result.review.model, 'fake/fake-review')
  assert.equal(result.review.usage.outputTokens, 180)
  const node = buildState().paths[0].nodes[0]
  assert.equal(node.status, '已通过复盘')
  assert.equal(node.review_state, 'done')
  assert.equal(node.versions[0].review.dimensions.length, 3, '首版复盘 3 个维度')
}

// 3. 引用缺失：两次尝试都被拒 → runReview 抛错 → recordReviewFailure 后节点停在「已提交」
{
  startNode('A2')
  submitVersion('A2', CONTENT, '')
  const submissionId = buildState().paths[0].nodes[1].versions[0].submission_id
  const ctx = fakeCtx([JSON.stringify(noQuoteReview())])
  await assert.rejects(() => runReview(ctx, 'A2', submissionId), /引用/)
  recordReviewFailure('A2', submissionId, '复盘被拒绝：理由没有引用交付物原文')
  const node2 = buildState().paths[0].nodes[1]
  assert.equal(node2.status, '已提交', '复盘失败不能改状态')
  assert.equal(node2.review_state, 'failed')
  assert.match(node2.versions[0].review_error, /引用/)
  assert.ok(buildState().audit.events.some((event) => event.action === 'review_failed'), '审计应记录复盘失败')
  assert.deepEqual(readAudit().events.filter((event) => event.action === 'review_attempt_failed').length, 2, '缺引用应重试一次')
}

// 4. 重做版本：第一次漏「迭代痕迹」被拒，第二次补上 → 通过，attempts=2
{
  startNode('A3')
  submitVersion('A3', CONTENT, '')
  applyReview({
    node_id: 'A3',
    dimensions: [
      { name: '完成度', verdict: '部分通过', reason: `只写了 ${quote('把两个独立信号合并成一个判断的机制')}，证据不全。` },
      { name: '证据充分性', verdict: '不通过', reason: `缺少来源 ${quote('红绿灯把亮灯与通行合并')}。` },
      { name: '结构清晰度', verdict: '通过', reason: `顺序可读 ${quote('反例：两个信号彼此独立时')}。` },
    ],
    next_actions: [{ text: '补齐来源后重做。', node_id: 'A3' }],
  })
  assert.equal(buildState().paths[0].nodes[2].status, '需重做')
  submitVersion('A3', `${CONTENT} 补充来源：《认知科学导论》p.42。`, '补齐来源页码并重写反例。')
  const submissionId = loadPaths().paths[0].nodes[2].versions[1].submission_id
  const missingIteration = {
    ...passReview(),
    dimensions: passReview().dimensions,
  }
  const withIteration = {
    ...passReview(),
    dimensions: [
      ...passReview().dimensions,
      { name: '迭代痕迹', verdict: '通过', reason: `修改理由提到的来源补上了 ${quote('《认知科学导论》p.42')}。` },
    ],
  }
  const ctx = fakeCtx([JSON.stringify(missingIteration), JSON.stringify(withIteration)])
  const result = await runReview(ctx, 'A3', submissionId)
  assert.equal(result.status, '已通过复盘')
  assert.equal(result.review.attempts, 2, '缺维度应触发一次重试')
  assert.equal(result.review.dimensions.length, 4, '重做复盘 4 个维度')
}

// 5. 非法 JSON：重试后仍失败
{
  startNode('B1')
  submitVersion('B1', CONTENT, '')
  const submissionId = buildState().paths[1].nodes[0].versions[0].submission_id
  const ctx = fakeCtx(['不是 JSON', '还是不是 JSON'])
  await assert.rejects(() => runReview(ctx, 'B1', submissionId), /JSON/)
  assert.equal(buildState().paths[1].nodes[0].status, '已提交')
}

// 6. 解析容忍代码围栏与前后解释
{
  const parsed = parseReviewJson('好的，结果如下：\n```json\n{"dimensions":[],"next_actions":[]}\n```\n以上。')
  assert.deepEqual(parsed.dimensions, [])
}

console.log('REVIEW OK', {
  reviews: buildState().paths.flatMap((path) => path.nodes).reduce((sum, node) => sum + node.reviews.length, 0),
  states: buildState().paths.flatMap((path) => path.nodes.map((node) => `${node.node_id}:${node.status}`)),
})
