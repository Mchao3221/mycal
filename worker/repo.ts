// 仓库坐标。单独成文件是因为取数已经搬到浏览器侧(见 src/utils/giteeClient.ts):
// Worker 到 gitee.com 的网络不通(实测 fetch 直接超时),服务端拿不到任何内容,
// 所以 worker 只需要知道「读的是哪个仓库」以及存哪里。

const DEFAULT_OWNER = 'chu-tianshu'
const DEFAULT_REPO = 'my-docs'
const DEFAULT_BRANCH = 'master'

export interface RepoInfo {
  owner: string
  repo: string
  branch: string
}

/** 读路径不需要任何凭据:内容已经在 D1 里了 */
export function repoInfo(env: { GITEE_OWNER?: string; GITEE_REPO?: string; GITEE_BRANCH?: string }): RepoInfo {
  return {
    owner: (env.GITEE_OWNER ?? DEFAULT_OWNER).trim(),
    repo: (env.GITEE_REPO ?? DEFAULT_REPO).trim(),
    branch: (env.GITEE_BRANCH ?? DEFAULT_BRANCH).trim(),
  }
}
