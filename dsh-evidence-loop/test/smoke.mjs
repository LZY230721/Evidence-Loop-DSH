// 数据层自测：状态机 + 落盘 + 强引用校验（复盘引擎用 test/review.mjs 覆盖）。
import assert from 'node:assert/strict'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Blocked, applyReview, startNode, submitVersion } from '../lib/machine.js'
import { buildState } from '../lib/state.js'
import { DATA_DIR, loadPaths, savePaths } from '../lib/store.js'

const tmp = process.env.DSH_HOME
assert.ok(tmp && tmp.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录，避免污染真实数据')
rmSync(join(tmp, 'evidence-loop'), { recursive: true, force: true })

const expectBlocked = (fn, label) => {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof Blocked, `${label}: 应抛出 Blocked，实际 ${err && err.name}: ${err && err.message}`)
    return err
  }
  throw new Error(`${label}: 预期被拦截，实际通过`)
}

const V1 = '概念 X 的定义：它是把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。反例：两个信号彼此独立时，合并会丢掉信息。'
const V2 = '概念 X 的定义来自《认知科学导论》p.42：把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。新增边界案例：两个信号彼此独立时合并会丢掉信息，因此规则只在两个信号同源时成立。'
const q = (text) => `「${text}」`

// 1. 初始化 + 开始
const state0 = buildState()
assert.equal(state0.stats.total, 14)
assert.deepEqual(state0.paths.map((p) => p.path_id), ['A', 'B', 'C'])
assert.equal(state0.focus.node_id, 'A1')
assert.equal(state0.focus.suggested_week, 'W1—W2')
assert.match(state0.paths[0].nodes[0].tutorial, /Dify/)
assert.equal(state0.paths[0].nodes[0].tutorial_url, 'https://cloud.dify.ai')
startNode('A1')
expectBlocked(() => startNode('A1'), '重复开始')
expectBlocked(() => submitVersion('A1', '太短', ''), '过短内容')

// 2. 首次提交 v1
const v1 = submitVersion('A1', V1, '')
assert.equal(v1.submission.version, 1)
assert.ok(existsSync(join(DATA_DIR, 'submissions', `${v1.submission.submission_id}.json`)), '提交快照应写入 submissions/')

// 3. 复盘：需重做（3 维，带原文引用）
const r1 = applyReview({
  node_id: 'A1',
  dimensions: [
    { name: '完成度', verdict: '部分通过', reason: `交付物写了 ${q('把两个独立信号合并成一个判断的机制')}，但边界没交代。` },
    { name: '证据充分性', verdict: '不通过', reason: `结论缺少来源 ${q('红绿灯把亮灯与通行合并')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `顺序可读 ${q('反例：两个信号彼此独立时')}。` },
  ],
  next_actions: [{ text: '补齐来源页码后重做。', node_id: 'A1' }],
})
assert.equal(r1.status, '需重做')
assert.ok(existsSync(join(DATA_DIR, 'reviews', `${r1.review.review_id}.json`)), '复盘应写入 reviews/')

// 4. 重做必须带理由
expectBlocked(() => submitVersion('A1', V2, ''), '重做缺理由')
const v2 = submitVersion('A1', V2, '补上了 v1 缺少的来源页码，并重写了反例段落')
assert.equal(v2.submission.version, 2)
assert.ok(existsSync(join(DATA_DIR, 'rework-reasons', `${v2.submission.submission_id}.json`)), '重做理由应写入 rework-reasons/')
const pathsAfterV2 = loadPaths()
const nodeA1 = pathsAfterV2.paths[0].nodes[0]
assert.equal(nodeA1.versions.length, 2)
assert.equal(nodeA1.versions[1].rework_reason, '补上了 v1 缺少的来源页码，并重写了反例段落')
assert.equal(nodeA1.versions[0].version, 1, '旧版本必须保留')

// 5. 强引用校验：没有原文引用 → 拒绝且状态不变
const noQuote = expectBlocked(
  () =>
    applyReview({
      node_id: 'A1',
      dimensions: [
        { name: '完成度', verdict: '通过', reason: '交付物覆盖了节点要求的三段内容。' },
        { name: '证据充分性', verdict: '通过', reason: '有来源页码，可以作为核查依据。' },
        { name: '结构清晰度', verdict: '通过', reason: '段落顺序清楚，结论可以顺着读到。' },
        { name: '迭代痕迹', verdict: '通过', reason: '相比上一版补上了缺失的来源。' },
      ],
      next_actions: [{ text: '继续。' }],
    }),
  '无引用复盘'
)
assert.match(noQuote.message, /引用/)
assert.equal(loadPaths().paths[0].nodes[0].status, '已提交', '被拒复盘不能改状态')

// 6. 合法复盘：全部通过 + 引用原文 → 已通过复盘（重做版本 4 维）
const passed = applyReview({
  node_id: 'A1',
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `交付物写全了定义与边界 ${q('把两个独立信号合并成一个判断的机制')}。` },
    { name: '证据充分性', verdict: '通过', reason: `来源可核查 ${q('《认知科学导论》p.42')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `结构清楚 ${q('新增边界案例')}。` },
    { name: '迭代痕迹', verdict: '通过', reason: `修改理由落在 ${q('《认知科学导论》p.42')}。` },
  ],
  next_actions: [{ text: '用同一套证据结构推进 A2。', node_id: 'A2' }],
  source: 'ai',
  usage: { inputTokens: 1000, outputTokens: 150 },
})
assert.equal(passed.status, '已通过复盘')

// 7. 状态统计与 focus 前移
const state1 = buildState()
assert.equal(state1.stats.passed, 1)
assert.equal(state1.stats.total, 14)
assert.equal(state1.focus.node_id, 'A2')
assert.equal(state1.meta.streak.current, 1, '提交应记 1 天连续学习')
const focusPath = state1.paths[0]
assert.equal(focusPath.completion.passed, 1)
assert.equal(focusPath.nodes[0].versions[0].review_decision, '需重做')
assert.equal(focusPath.nodes[0].versions[1].review_decision, '已通过复盘')
assert.equal(focusPath.nodes[0].versions[0].review.dimensions.length, 3, '首版复盘 3 个维度')
assert.equal(focusPath.nodes[0].versions[1].review.dimensions.length, 4, '重做复盘 4 个维度')
assert.equal(focusPath.nodes[0].next_actions[0].node_id, 'A2', 'next_actions 应写回节点')

// 8. 审计日志
const audit = buildState().audit
assert.ok(audit.count >= 6)
const actions = audit.events.map((event) => event.action)
assert.ok(actions.includes('seed'))
assert.ok(actions.includes('status_change'))
assert.ok(actions.includes('blocked'))
assert.ok(actions.includes('review_rejected'))
assert.ok(actions.includes('review_applied'))

// 9. 未开始的节点不能提交
expectBlocked(() => submitVersion('B1', '未开始就不该能提交任何内容。', ''), '未开始提交')

// 10. 连续天数过期后不再显示旧值
const data = loadPaths()
data.meta.streak = { current: 7, longest: 7, last_submit_date: '2020-01-01' }
savePaths(data)
const stale = buildState()
assert.equal(stale.meta.streak.current, 0, '中断的连续天数应归零')
assert.equal(stale.meta.streak.stale, true, '应标记 stale 供 UI 区分')
assert.equal(stale.meta.streak.longest, 7, '最长记录保留')

// 11. 旧数据迁移：缺少 tutorial 的节点会被自动补齐
const raw = loadPaths()
delete raw.paths[0].nodes[0].tutorial
savePaths(raw)
const migrated = loadPaths()
assert.match(migrated.paths[0].nodes[0].tutorial, /第一步/, '迁移应补回实操指南')

// 显式置空代表用户有意关闭，不得被迁移还原
const explicit = loadPaths()
explicit.paths[0].nodes[1].tutorial = ''
explicit.paths[0].nodes[1].tutorial_url = ''
savePaths(explicit)
const kept = loadPaths()
assert.equal(kept.paths[0].nodes[1].tutorial, '', '空字符串不应被迁移覆盖')
assert.equal(kept.paths[0].nodes[1].tutorial_url, '', '空链接不应被迁移覆盖')

console.log('SMOKE OK', {
  data_dir: DATA_DIR,
  submissions: readdirSync(join(DATA_DIR, 'submissions')).length,
  reviews: readdirSync(join(DATA_DIR, 'reviews')).length,
  reworks: readdirSync(join(DATA_DIR, 'rework-reasons')).length,
  audit_events: audit.count,
})
