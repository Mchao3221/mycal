// 全局共享类型(v0.5.0 只读文档阅读器)。
// 注意:前后端两套 tsconfig 不共享代码,worker 侧有自己的一份同名类型,改这里时留意别改错文件。

/** 目录树里单个文件(worker /api/docs/tree 返回) */
export interface TreeFile {
  /** 仓库内相对路径,正斜杠分隔 */
  path: string
  size: number
  sha: string
}

/** GET /api/docs/tree 的响应(v0.7.0 起由开发服务器直接扫描本机目录) */
export interface DocsTree {
  /** 本机文档目录的绝对路径,顶栏直接显示它 */
  dir: string
  /** git HEAD 短 sha;取不到(不是 git 仓库 / 没装 git)时为空串 */
  rev: string
  fetchedAt: number
  /** 全部文件的字节数合计 */
  totalBytes: number
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
