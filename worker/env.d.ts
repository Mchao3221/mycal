/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** wrangler.jsonc 中的 D1 绑定 */
  mycalDB: D1Database
  /** AI 服务兜底配置(可被 settings 表覆盖);密钥建议用 wrangler secret put AI_API_KEY */
  AI_BASE_URL?: string
  AI_API_KEY?: string
  AI_MODEL?: string
}
