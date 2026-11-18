// 分享页自测：模型筛选、Bad Case 归因、HTML 转义、发布参数（不传 channel）。
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { applyReview, startNode, submitVersion } from '../lib/machine.js'
import { buildShareModel, generateShare, renderShareHtml, saveShareNote, readShareNote } from '../lib/share.js'
import { listReviews, loadPaths } from '../lib/store.js'

assert.ok(process.env.DSH_HOME && process.env.DSH_HOME.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录')
rmSync(join(process.env.DSH_HOME, 'evidence-loop'), { recursive: true, force: true })

const V1 = '概念 X 的定义：它是把两个独立信号合并成一个判断的机制。最小例子：红绿灯把亮灯与通行合并。'
const V2 = '概念 X 的定义来自《认知科学导论》p.42：把两个独立信号合并成一个判断的机制。新增边界案例：两个信号独立时合并会丢信息。'
const q = (text) => `「${text}」`

startNode('A1')
submitVersion('A1', V1, '')
applyReview({
  node_id: 'A1',
  dimensions: [
    { name: '完成度', verdict: '部分通过', reason: `写了定义 ${q('把两个独立信号合并成一个判断的机制')}，边界没交代。` },
    { name: '证据充分性', verdict: '不通过', reason: `缺少来源 ${q('红绿灯把亮灯与通行合并')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `顺序可读 ${q('红绿灯把亮灯与通行合并')}。` },
  ],
  next_actions: [{ text: '补齐来源后重做。', node_id: 'A1' }],
})
submitVersion('A1', V2, '补上来源页码，并补了边界案例')
applyReview({
  node_id: 'A1',
  dimensions: [
    { name: '完成度', verdict: '通过', reason: `定义完整 ${q('把两个独立信号合并成一个判断的机制')}。` },
    { name: '证据充分性', verdict: '通过', reason: `来源可核查 ${q('《认知科学导论》p.42')}。` },
    { name: '结构清晰度', verdict: '通过', reason: `结构清楚 ${q('新增边界案例')}。` },
    { name: '迭代痕迹', verdict: '通过', reason: `修改理由落实 ${q('《认知科学导论》p.42')}。` },
  ],
  next_actions: [{ text: '推进 A2。', node_id: 'A2' }],
})

const note = '我学到：<script>alert(1)</script> 先补来源，再下结论。'
saveShareNote(note)
assert.equal(readShareNote().note, note)

const model = buildShareModel({ data: loadPaths(), reviews: listReviews(), note })
assert.equal(model.key_events.length, 1)
assert.equal(model.key_events[0].reason, '补上来源页码，并补了边界案例')
assert.equal(model.summary.rework_total, 1)
assert.equal(model.badcases.length, 1)
assert.equal(model.badcases[0].dimension, '证据充分性', '按最弱维度归因')
assert.equal(model.badcases[0].count, 1)
assert.equal(model.badcases[0].typical.node_id, 'A1')

const html = renderShareHtml(model)
assert.match(html, /我的学习证据台账/)
assert.match(html, /关键重做/)
assert.match(html, /我的 Bad Case 台账/)
assert.match(html, /补上来源页码，并补了边界案例/)
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, '学习者心得必须转义')
assert.equal(html.includes('<script>alert(1)</script>'), false, '不得注入原始脚本')

let captured = null
const okCtx = {
  get(name) {
    if (name === 'shareLink') {
      return {
        async createPathShare(path, options) {
          captured = { path, options }
          return { url: 'https://share.example.test/s/xyz', id: 'xyz', expiresAt: Date.now() + 3600_000, provider: 'tunnel' }
        },
      }
    }
    return undefined
  },
}
const result = await generateShare(okCtx, { ttlHours: 99999 })
assert.equal(result.publish.url, 'https://share.example.test/s/xyz')
assert.equal(result.ttl_hours, 720, 'TTL 应被夹到 30 天')
assert.ok(existsSync(result.path))
assert.ok(captured, '应调用 shareLink.createPathShare')
assert.equal('channel' in captured.options, false, '发布参数不得包含 channel')
assert.equal(captured.options.ttlHours, 720)

const noShare = await generateShare({ get: () => undefined }, {})
assert.equal(noShare.publish, null)
assert.match(noShare.publish_error, /分享服务不可用/)
assert.ok(existsSync(noShare.path), '发布失败也应保留本地 HTML')
assert.ok(noShare.local_path.endsWith('.html'), '应返回本机预览路径')

// 6.1 上游把 api.trycloudflare.com 当隧道地址：必须拒绝并撤销
let revoked = null
const badCtx = {
  get(name) {
    if (name === 'shareLink') {
      return {
        async createPathShare() {
          return { url: 'https://api.trycloudflare.com/s/abc123/', id: 'bad-entry', expiresAt: Date.now() + 3600_000, provider: 'tunnel' }
        },
        async revoke(id) {
          revoked = id
          return true
        },
      }
    }
    return undefined
  },
}
const bad = await generateShare(badCtx, {})
assert.equal(bad.publish, null, '不得把 API 主机当成公网链接')
assert.match(bad.publish_error, /无效地址/)
assert.equal(revoked, 'bad-entry', '应撤销无效分享记录')
assert.ok(existsSync(bad.path))

// 7. 短交付物的 summary 会等于全文：分享页必须再做展示级截断
const longSummary = '长'.repeat(200)
const longModel = {
  generated_at: new Date().toISOString(),
  note: '',
  key_events: [{
    node_id: 'X1',
    node_title: '测试节点',
    path_id: 'X',
    path_title: '测试路径',
    before: { version: 1, summary: longSummary, at: new Date().toISOString() },
    beforeReview: null,
    reason: '测试',
    after: { version: 2, summary: longSummary, at: new Date().toISOString(), decision: '已通过复盘' },
  }],
  badcases: [],
  summary: { passed: 0, total_nodes: 1, rework_total: 1, rework_nodes: 1, reviews: 0 },
}
const longHtml = renderShareHtml(longModel)
assert.ok(longHtml.includes(`${'长'.repeat(80)}…`), '分享页摘要应截断到 80 字')
assert.equal(longHtml.includes('长'.repeat(120)), false, '分享页不得输出长摘要全文')

console.log('SHARE OK', {
  path: result.path,
  url: result.publish.url,
  badcases: model.badcases.map((group) => `${group.dimension}:${group.count}`),
})
