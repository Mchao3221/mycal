// 全局共享类型(v0.5.0 只读文档阅读器)。
// 注意:前后端两套 tsconfig 不共享代码,worker 侧有自己的一份同名类型,改这里时留意别改错文件。

/** 目录树里单个文件(worker /api/docs/tree 返回) */
export interface TreeFile {
  /** 仓库内相对路径,正斜杠分隔 */
  path: string
  size: number
  sha: string
}

/** GET /api/docs/tree 的响应 */
export interface DocsTree {
  owner: string
  repo: string
  branch: string
  /** 分支最新 commit sha,内容一变它就变,可当版本号 */
  rev: string
  fetchedAt: number
  /** Gitee 侧树被截断(文件过多)时为 true */
  truncated: boolean
  files: TreeFile[]
}

/** GET /api/lock/status 的响应 */
export interface LockStatus {
  /** 是否已设置访问码(未设置先走设置流程) */
  isSet: boolean
  unlocked: boolean
}

/**
 * 文件的预览方式。
 * markdown = 渲染成图文;code = 只读高亮;image = 直接显示;
 * epub = 在线阅读;external = 新窗口打开交给浏览器。
 * 注:`.excalidraw` 已归入 external —— 画布渲染(官方包 1MB+)已整体移除。
 */
export type FileKind = 'markdown' | 'code' | 'image' | 'epub' | 'external'

/** 目录树节点(由扁平路径在前端拼出来,git 不跟踪空目录,所以不会出现空节点) */
export interface TreeNode {
  name: string
  /** 目录为自身路径,文件为完整路径 */
  path: string
  isDir: boolean
  children: TreeNode[]
  /** 文件字节数;目录为 0 */
  size: number
  /** 目录下(含所有子目录)的文件总数 */
  fileCount: number
}
