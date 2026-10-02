import { iconOf } from '../utils/fileKind'
import type { TreeNode } from '../types'

interface Props {
  root: TreeNode
  currentPath: string | null
  /** 展开的目录路径集合(状态由 App 持有并存 localStorage) */
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

/** 每行共用的一行样式:紧凑、可点、名字过长省略 */
const ROW =
  'flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[13px] leading-5 transition-colors'

/**
 * 左侧目录树。
 * 默认全部折叠 —— 这个仓库有 789 个文件,一进页面就全展开既卡又难找。
 * 不做虚拟滚动:折叠状态下 DOM 里只有顶层几个目录节点,展开某个目录也最多几百行,不值得引库。
 */
export function DocTree({ root, currentPath, expanded, onToggle, onSelect }: Props) {
  return (
    <ul className="flex flex-col gap-px pb-2">
      {root.children.map(child => (
        <TreeRow
          key={child.path}
          node={child}
          depth={0}
          currentPath={currentPath}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

interface RowProps extends Omit<Props, 'root'> {
  node: TreeNode
  depth: number
}

function TreeRow({ node, depth, currentPath, expanded, onToggle, onSelect }: RowProps) {
  const indent = { paddingLeft: `${depth * 14 + 6}px` }

  if (node.isDir) {
    const open = expanded.has(node.path)
    return (
      <li>
        <button
          type="button"
          className={`${ROW} text-base-content/75 hover:bg-base-200`}
          style={indent}
          onClick={() => onToggle(node.path)}
          aria-expanded={open}
          title={node.path}
        >
          <span className="w-4 shrink-0 text-center text-[10px] text-base-content/40">{open ? '▾' : '▸'}</span>
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-base-content/35">
            {node.fileCount}
          </span>
        </button>
        {open && (
          <ul className="flex flex-col gap-px">
            {node.children.map(child => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                currentPath={currentPath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const active = node.path === currentPath
  return (
    <li>
      <button
        type="button"
        className={`${ROW} ${
          active ? 'bg-primary/10 font-medium text-primary' : 'text-base-content/75 hover:bg-base-200'
        }`}
        style={indent}
        onClick={() => onSelect(node.path)}
        title={node.path}
      >
        <span className="w-4 shrink-0 text-center text-[9px] text-base-content/40">{iconOf(node.path)}</span>
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}
