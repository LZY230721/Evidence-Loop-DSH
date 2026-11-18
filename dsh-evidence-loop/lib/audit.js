// 证据回路 · 审计台投影：轨迹时间线、质量趋势、重做热区、当前下一步。
import { loadPaths, listReviews, readAudit } from './store.js'

const SCORE = { 通过: 3, 部分通过: 2, 不通过: 1 }
export const DIMENSIONS = ['完成度', '证据充分性', '结构清晰度', '迭代痕迹']

export function buildAudit() {
  const data = loadPaths()
  const reviews = listReviews()
  const flat = []
  for (const path of data.paths) for (const node of path.nodes || []) flat.push({ path, node })
  const byId = new Map(flat.map((item) => [item.node.node_id, item]))

  // 质量趋势：横轴是提交版本序号（复盘记录按时间排序后的第 N 次提交），不是周次。
  const series = reviews.map((review, index) => {
    const values = {}
    const verdicts = {}
    for (const dim of review.dimensions || []) {
      if (!(dim.verdict in SCORE)) continue
      values[dim.name] = SCORE[dim.verdict]
      verdicts[dim.name] = dim.verdict
    }
    const entry = byId.get(review.node_id)
    return {
      seq: index + 1,
      review_id: review.review_id,
      node_id: review.node_id,
      node_title: entry ? entry.node.title : '',
      path_id: entry ? entry.path.path_id : '',
      version: review.version,
      at: review.created_at,
      decision: review.decision,
      values,
      verdicts,
      model: review.model || null,
      attempts: review.attempts || 1,
    }
  })

  // 轨迹时间线：全部审计事件，重做相关事件带 rework 标记供 UI 高亮。
  const events = readAudit(400).events.slice().reverse().map((event) => {
    const entry = event.node_id ? byId.get(event.node_id) : null
    return {
      ...event,
      node_title: entry ? entry.node.title : '',
      rework: event.trigger === 'resubmit'
        || (event.action === 'review_applied' && Number(event.version) > 1),
    }
  })

  // 重做热区：按重做次数排序。
  const hotspots = flat
    .map(({ path, node }) => {
      const versions = node.versions || []
      const last = [...versions].reverse().find((version) => version.rework_reason)
      return {
        node_id: node.node_id,
        title: node.title,
        path_id: path.path_id,
        status: node.status,
        version_count: versions.length,
        rework_count: versions.filter((version) => version.rework_reason).length,
        last_reason: last ? last.rework_reason : '',
      }
    })
    .filter((item) => item.rework_count > 0)
    .sort((a, b) => b.rework_count - a.rework_count || a.node_id.localeCompare(b.node_id))

  // 当前下一步：所有节点写回的 next_actions，扁平化成待办（最近复盘的排在前面）。
  const next_actions = []
  for (const { path, node } of flat) {
    for (const action of node.next_actions || []) {
      next_actions.push({
        node_id: node.node_id,
        node_title: node.title,
        path_id: path.path_id,
        status: node.status,
        at: node.next_actions_at || '',
        text: action.text,
        target_node_id: action.node_id || node.node_id,
      })
    }
  }
  next_actions.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.node_id.localeCompare(b.node_id))

  const reworkTotal = flat.reduce(
    (sum, { node }) => sum + (node.versions || []).filter((version) => version.rework_reason).length,
    0
  )

  return {
    ok: true,
    dimensions: DIMENSIONS,
    series,
    events,
    hotspots,
    next_actions,
    summary: {
      reviews: reviews.length,
      rework_total: reworkTotal,
      passed: flat.filter(({ node }) => node.status === '已通过复盘').length,
      rework_nodes: hotspots.length,
      nodes_with_reviews: new Set(series.map((item) => item.node_id)).size,
    },
  }
}
