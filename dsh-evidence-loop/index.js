// 证据回路 · Host 半边：本地文件仓 + 硬编码状态机 + AI 复盘 + 面板 API。
// 浏览器半边的面板由 dsh.client 声明的 client.js 提供。
import { registerApi } from './lib/api.js'
import { abortAllReviews } from './lib/review.js'
import { ensureStore, appendAudit } from './lib/store.js'
import { API_VERSION } from './lib/version.js'

export const name = 'evidence-loop'
export const inject = ['webServer']

export function apply(ctx) {
  ensureStore()
  // 每次宿主加载留一条启动记录：数据里能直接确认「运行的是不是新版宿主」。
  appendAudit({ action: 'plugin_boot', api_version: API_VERSION })
  ctx.effect(() => {
    const dispose = registerApi(ctx)
    return () => {
      dispose()
      abortAllReviews()
    }
  }, `${name}: api`)
}
