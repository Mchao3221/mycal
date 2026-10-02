import { iconOf, iconToneOf } from '../utils/fileKind'
import type { TreeNode } from '../types'

interface Props {
  root: TreeNode
  currentPath: string | null
  /** 展开的目录路径集合(状态由 App 持有并存 localStorage) */
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  /** 鼠标停在某个文件上时预热它的内容(由 App 做防抖 + 缓存) */
  onHover?: (path: string) => void
}

/**
 * 每行共用的一行样式:紧凑、可点、名字过长省略。
 * 行高从 py-[3px] 放到 py-1 —— 原先行太挤,鼠标不容易命中,视觉上也显得"小"。
 */
const ROW = 'flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-[13px] leading-5 transition-colors'

/** 展开箭头:用 SVG chevron 而不是 ▸/▾ 字符 —— 字符在不同字体下大小和粗细都不可控 */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      className={`shrink-0 text-base-content/55 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M4.5 2.5 L8 6 L4.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 左侧目录树。
 * 默认全部折叠 —— 这个仓库有 789 个文件,一进页面就全展开既卡又难找。
 * 不做虚拟滚动:折叠状态下 DOM 里只有顶层几个目录节点,展开某个目录也最多几百行,不值得引库。
 */
export function DocTree({ root, currentPath, expanded, onToggle, onSelect, onHover }: Props) {
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
          onHover={onHover}
        />
      ))}
    </ul>
  )
}

interface RowProps extends Omit<Props, 'root'> {
  node: TreeNode
  depth: number
}

function TreeRow({ node, depth, currentPath, expanded, onToggle, onSelect, onHover }: RowProps) {
  const indent = { paddingLeft: `${depth * 14 + 6}px` }

  if (node.isDir) {
    const open = expanded.has(node.path)
    return (
      <li>
        <button
          type="button"
          className={`${ROW} ${open ? 'text-base-content/85' : 'text-base-content/70'} hover:bg-base-200`}
          style={indent}
          onClick={() => onToggle(node.path)}
          aria-expanded={open}
          title={node.path}
        >
          <Caret open={open} />
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
                onHover={onHover}
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
          active ? 'bg-primary/12 font-medium text-primary' : 'text-base-content/75 hover:bg-base-200'
        }`}
        style={indent}
        onClick={() => onSelect(node.path)}
        onMouseEnter={onHover ? () => onHover(node.path) : undefined}
        title={node.path}
      >
        {/* 16px 固定列:图标比原来大一档并带类型配色,便于在密集列表里扫 */}
        <span className={`w-[16px] shrink-0 text-center text-[11px] font-semibold ${active ? '' : iconToneOf(node.path)}`}>
          {iconOf(node.path)}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}
