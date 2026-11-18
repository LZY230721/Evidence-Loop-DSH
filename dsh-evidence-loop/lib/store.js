// 证据回路 · 本地文件存储。
//
//   ~/.dsh/evidence-loop/
//   ├── paths.json          学习路径与技能树节点（含 suggested_week / status / versions）
//   ├── submissions/        每次作业提交的版本快照
//   ├── reviews/            每次复盘的完整记录
//   ├── rework-reasons/     每次重做时学习者填写的修改理由
//   └── audit-log.json      所有路由决策与拦截事件的追加日志
//
// 原子写：tmp + rename；路径解析优先 DSH_HOME，缺省 ~/.dsh（与 DSH 其他数据目录一致）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { buildSeed, NODE_EXTERNAL_CHECK, NODE_TUTORIALS, STORE_VERSION } from './seed.js'

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const DATA_DIR = join(DSH_HOME, 'evidence-loop')
export const PATHS_FILE = join(DATA_DIR, 'paths.json')
export const AUDIT_FILE = join(DATA_DIR, 'audit-log.json')
export const SUBMISSIONS_DIR = join(DATA_DIR, 'submissions')
export const REVIEWS_DIR = join(DATA_DIR, 'reviews')
export const REWORK_DIR = join(DATA_DIR, 'rework-reasons')
export const SHARE_DIR = join(DATA_DIR, 'share')
export const SHARE_NOTE_FILE = join(DATA_DIR, 'share-note.json')
export const CHAT_DIR = join(DATA_DIR, 'chat')

const AUDIT_CAP = 5000

export const nowIso = () => new Date().toISOString()

// 本地日期（连续学习天数按学习者本机时区计）
export function localDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function ensureDirs() {
  for (const dir of [DATA_DIR, SUBMISSIONS_DIR, REVIEWS_DIR, REWORK_DIR, SHARE_DIR, CHAT_DIR]) mkdirSync(dir, { recursive: true })
}

export function ensureStore() {
  ensureDirs()
  if (!existsSync(PATHS_FILE)) {
    writeJson(PATHS_FILE, buildSeed(nowIso()))
    appendAudit({ action: 'seed', detail: '初始化学习路径 A/B/C' })
  }
  if (!existsSync(AUDIT_FILE)) writeJson(AUDIT_FILE, { version: 1, events: [] })
  migrateExternalFlags()
  migrateTutorials()
}

// 旧数据迁移：只在字段「缺失」时补教程与跳转链接。
// 约定：显式空字符串 = 用户有意关闭该节点的指南/链接，迁移不得覆盖。
export function migrateTutorials() {
  const data = readJson(PATHS_FILE)
  if (!data || !Array.isArray(data.paths)) return false
  let changed = false
  for (const path of data.paths) {
    for (const node of path.nodes || []) {
      const tutorial = NODE_TUTORIALS[node.node_id]
      if (!tutorial) continue
      if (node.tutorial === undefined) { node.tutorial = tutorial.text; changed = true }
      if (node.tutorial_label === undefined) { node.tutorial_label = tutorial.label; changed = true }
      if (node.tutorial_url === undefined) { node.tutorial_url = tutorial.url; changed = true }
    }
  }
  if (changed) writeJson(PATHS_FILE, data)
  return changed
}

// 旧数据迁移：为缺少 external_check 的节点补默认值（只写一次）。
export function migrateExternalFlags() {
  const data = readJson(PATHS_FILE)
  if (!data || !Array.isArray(data.paths)) return false
  let changed = false
  for (const path of data.paths) {
    for (const node of path.nodes || []) {
      if (typeof node.external_check !== 'boolean') {
        node.external_check = NODE_EXTERNAL_CHECK[node.node_id] === true
        changed = true
      }
    }
  }
  if (changed) writeJson(PATHS_FILE, data)
  return changed
}

export function loadPaths() {
  ensureStore()
  const data = readJson(PATHS_FILE)
  if (!data || !Array.isArray(data.paths)) throw new Error(`paths.json 损坏或缺少 paths 数组：${PATHS_FILE}`)
  if (!data.meta) data.meta = { streak: { current: 0, longest: 0, last_submit_date: null } }
  if (!data.meta.streak) data.meta.streak = { current: 0, longest: 0, last_submit_date: null }
  if (data.version !== STORE_VERSION) data.version = STORE_VERSION
  return data
}

export function savePaths(data) {
  data.updated_at = nowIso()
  writeJson(PATHS_FILE, data)
  return data
}

export function findNode(data, nodeId) {
  if (!nodeId) return null
  for (const path of data.paths) {
    for (const node of path.nodes || []) {
      if (node.node_id === nodeId) return { path, node }
    }
  }
  return null
}

export function listNodes(data) {
  const out = []
  for (const path of data.paths) for (const node of path.nodes || []) out.push({ path, node })
  return out
}

// ── 审计日志：只追加，永不改写历史 ─────────────────────────────────────
export function appendAudit(entry) {
  ensureDirs()
  const log = readJson(AUDIT_FILE, { version: 1, events: [] })
  if (!Array.isArray(log.events)) log.events = []
  const event = {
    id: `evt_${Date.now()}_${randomUUID().slice(0, 6)}`,
    at: nowIso(),
    ...entry,
  }
  log.events.push(event)
  if (log.events.length > AUDIT_CAP) log.events = log.events.slice(-AUDIT_CAP)
  writeJson(AUDIT_FILE, log)
  return event
}

export function readAudit(limit = 200) {
  const log = readJson(AUDIT_FILE, { version: 1, events: [] })
  const events = Array.isArray(log.events) ? log.events : []
  return { count: events.length, events: events.slice(-limit) }
}

// ── 提交 / 复盘 / 重做理由 ──────────────────────────────────────────────
export function newSubmissionId() {
  return `sub_${Date.now()}_${randomUUID().slice(0, 6)}`
}

export function newReviewId() {
  return `rv_${Date.now()}_${randomUUID().slice(0, 6)}`
}

export function summarize(text, max = 140) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function saveSubmission(record) {
  writeJson(join(SUBMISSIONS_DIR, `${record.submission_id}.json`), record)
  return record
}

export function saveReview(record) {
  writeJson(join(REVIEWS_DIR, `${record.review_id}.json`), record)
  return record
}

export function saveReworkReason(record) {
  writeJson(join(REWORK_DIR, `${record.submission_id}.json`), record)
  return record
}

export function listReviews() {
  ensureDirs()
  const out = []
  for (const name of readdirSync(REVIEWS_DIR)) {
    if (!name.endsWith('.json')) continue
    const record = readJson(join(REVIEWS_DIR, name))
    if (record && record.review_id) out.push(record)
  }
  return out.sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at))
    || String(a.review_id).localeCompare(String(b.review_id)))
}

export function listSubmissions() {
  ensureDirs()
  const out = []
  for (const name of readdirSync(SUBMISSIONS_DIR)) {
    if (!name.endsWith('.json')) continue
    const record = readJson(join(SUBMISSIONS_DIR, name))
    if (record && record.submission_id) out.push(record)
  }
  return out
}

// ── 连续学习天数：只在提交时计数 ───────────────────────────────────────
export function touchStreak(data, date = new Date()) {
  const streak = data.meta.streak
  const today = localDate(date)
  if (streak.last_submit_date === today) {
    // 同一天多次提交只算一天
  } else if (streak.last_submit_date) {
    const yesterday = localDate(new Date(date.getTime() - 24 * 60 * 60 * 1000))
    streak.current = streak.last_submit_date === yesterday ? streak.current + 1 : 1
  } else {
    streak.current = 1
  }
  streak.last_submit_date = today
  streak.longest = Math.max(streak.longest || 0, streak.current || 0)
  return streak
}
