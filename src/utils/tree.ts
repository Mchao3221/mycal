// 扁平文件路径 → 目录树,以及目录树相关的纯函数。
import type { TreeNode, TreeFile } from '../types'

/**
 * 中文目录名排序。
 * 用 localeCompare('zh') 而不是默认字典序,数字段落开 numeric 才会把
 * [0]/[1]/[10] 排成 0、1、10 而不是 0、1、10 之前的 0、1、10 字典序(0,1,10,2)。
 * sensitivity: 'base' 让大小写与变音符号不参与比较,避免同名文件忽前忽后。
 */
const collator = new Intl.Collator('zh', { numeric: true, sensitivity: 'base' })

/** 文件夹优先,再按名称;文件之间也同样规则 */
const compareNodes = (a: TreeNode, b: TreeNode): number => {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return collator.compare(a.name, b.name)
}

/** 由扁平路径列表拼出嵌套目录树(纯前端拼,worker 只回扁平列表省流量) */
export function buildTree(files: TreeFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [], size: 0, fileCount: 0 }
  const dirs = new Map<string, TreeNode>([['', root]])

  const ensureDir = (path: string, name: string): TreeNode => {
    const found = dirs.get(path)
    if (found) return found
    const node: TreeNode = { name, path, isDir: true, children: [], size: 0, fileCount: 0 }
    dirs.set(path, node)
    return node
  }

  for (const file of files) {
    const parts = file.path.split('/')
    const fileName = parts.pop() ?? file.path
    let parent = root
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      const dir = ensureDir(acc, part)
      // 只在第一次见到这个目录时挂到父节点上,避免重复 push
      if (!parent.children.includes(dir)) parent.children.push(dir)
      parent = dir
    }
    parent.children.push({
      name: fileName,
      path: file.path,
      isDir: false,
      children: [],
      size: file.size,
      fileCount: 0,
    })
  }

  // 递归排序并统计每个目录下的文件总数
  const finish = (node: TreeNode): number => {
    if (!node.isDir) return 1
    node.children.sort(compareNodes)
    let count = 0
    for (const child of node.children) count += finish(child)
    node.fileCount = count
    return count
  }
  finish(root)
  return root
}

/** 收集所有目录路径,用于「全部展开」与「默认折叠」两种初始状态 */
export function collectDirPaths(node: TreeNode, out: string[] = []): string[] {
  for (const child of node.children) {
    if (child.isDir) {
      out.push(child.path)
      collectDirPaths(child, out)
    }
  }
  return out
}

/** 从根到目标文件的所有祖先目录路径,用于「打开文件时自动展开其父目录」 */
export function ancestorsOf(filePath: string): string[] {
  const parts = filePath.split('/')
  parts.pop()
  const out: string[] = []
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    out.push(acc)
  }
  return out
}
