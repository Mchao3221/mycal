/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** wrangler.jsonc 中的 D1 绑定(仅服务访问码锁) */
  mycalDB: D1Database

  /**
   * Gitee 只读访问令牌。仓库是私有的,匿名访问一律 404/403,必须带令牌。
   * 本地:写进 .dev.vars;生产:wrangler secret put GITEE_TOKEN。
   * 令牌只在 Worker 侧使用,绝不出现在任何响应体或前端代码里。
   */
  GITEE_TOKEN?: string
  /** 仓库坐标,可省略,默认指向 chu-tianshu/my-docs 的 master 分支 */
  GITEE_OWNER?: string
  GITEE_REPO?: string
  GITEE_BRANCH?: string
  /**
   * 单个上游请求的超时(毫秒,1000~120000),默认 20000。
   * 云端要调这个值时不必改代码:直接在 Cloudflare 控制台改环境变量即可。
   */
  GITEE_TIMEOUT_MS?: string
}
