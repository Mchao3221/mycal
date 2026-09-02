/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** wrangler.jsonc 中的 D1 绑定 */
  mycalDB: D1Database
}
