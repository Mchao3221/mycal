/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** wrangler.jsonc 中的 D1 绑定:访问码锁 + 同步进来的仓库副本 */
  mycalDB: D1Database

  /**
   * 仓库坐标,只用于界面显示(顶栏那几个字),省略即用默认的 chu-tianshu/my-docs@master。
   *
   * 注意这里**没有令牌**:Worker 从 v0.6.2 起完全不访问 Gitee ——
   * 实测这条网络路径不通(fetch 直接超时),内容改由本机的 `pnpm run sync` 从本地目录推上来。
   */
  GITEE_OWNER?: string
  GITEE_REPO?: string
  GITEE_BRANCH?: string
}
