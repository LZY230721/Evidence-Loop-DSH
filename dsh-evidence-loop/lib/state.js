// 证据回路 · 面板状态装配（只读投影；不写盘）。
import { RANK_LADDER, rankFor } from './seed.js'
import { reviewRunningFor } from './review.js'
import { API_VERSION } from './version.js'
import { DATA_DIR, listReviews, loadPaths, localDate, nowIso, readAudit } from './store.js'

// 连续天数只在提交时累加，但读侧必须按「今天/昨天」判断是否已中断：
// 上周连续 7 天、这周没提交，不能继续显示 7 天。
function effectiveStreak(meta) {
  const streak = (meta && meta.streak) || { current: 0, longest: 0, last_submit_date: null }
  const last = streak.last_submit_date
  if (!last) return { current: 0, longest: streak.longest || 0, last_submit_date: null, stale: false }
  const today = localDate()
  const yesterday = localDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  if (last === today || last === yesterday) {
    return { current: streak.current || 0, longest: streak.longest || 0, last_submit_date: last, stale: false }
  }
  return { current: 0, longest: streak.longest || 0, last_submit_date: last, stale: true }
}

export function buildState() {
  const data = loadPaths()
  const reviews = listReviews()
  const reviewsByNode = new Map()
  for (const review of reviews) {
    const list = reviewsByNode.get(review.node_id) || []
    list.push(review)
    reviewsByNode.set(review.node_id, list)
  }

  const counters = { 未开始: 0, 练习中: 0, 已提交: 0, 已通过复盘: 0, 需重做: 0 }
  let total = 0
  let focus = null

  const paths = data.paths.map((path) => {
    const nodes = (path.nodes || []).map((node) => {
      total += 1
      counters[node.status] = (counters[node.status] || 0) + 1
      const nodeReviews = (reviewsByNode.get(node.node_id) || []).slice()
      const latest = (node.versions || []).length ? node.versions[node.versions.length - 1] : null
      const reviewState = !latest
        ? 'idle'
        : latest.review_id
          ? 'done'
          : reviewRunningFor(node.node_id, latest.submission_id)
            ? 'running'
            : latest.review_status === 'failed'
              ? 'failed'
              : 'idle'
      if (!focus && node.status !== '已通过复盘') {
        focus = {
          path_id: path.path_id,
          path_title: path.title,
          node_id: node.node_id,
          title: node.title,
          status: node.status,
          suggested_week: node.suggested_week,
        }
      }
      return {
        ...node,
        review_state: reviewState,
        versions: (node.versions || []).map((version) => ({
          ...version,
          review: version.review_id
            ? nodeReviews.find((review) => review.review_id === version.review_id) || null
            : null,
        })),
        reviews: nodeReviews,
      }
    })
    const passed = nodes.filter((node) => node.status === '已通过复盘').length
    return {
      path_id: path.path_id,
      title: path.title,
      summary: path.summary || '',
      nodes,
      completion: { passed, total: nodes.length },
    }
  })

  const passed = counters['已通过复盘'] || 0
  const rank = rankFor(passed)
  const rankIndex = RANK_LADDER.findIndex((step) => step.name === rank)
  const nextStep = RANK_LADDER[rankIndex + 1] || null
  const audit = readAudit(40)

  return {
    ok: true,
    api_version: API_VERSION,
    data_dir: DATA_DIR,
    generated_at: nowIso(),
    store_version: data.version,
    meta: { ...data.meta, streak: effectiveStreak(data.meta) },
    paths,
    focus,
    stats: {
      total,
      passed,
      submitted: counters['已提交'] || 0,
      rework: counters['需重做'] || 0,
      in_progress: counters['练习中'] || 0,
      not_started: counters['未开始'] || 0,
      rank,
      rank_index: rankIndex,
      rank_next: nextStep ? { name: nextStep.name, need: Math.max(0, nextStep.min - passed) } : null,
      passed_ratio: total ? passed / total : 0,
    },
    audit: { count: audit.count, events: audit.events },
  }
}
