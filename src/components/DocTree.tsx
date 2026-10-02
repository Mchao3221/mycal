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

/**
 * 顶层行的行高(py-1 8px + leading-5 20px = 28px,再加 ul 的 gap-px 1px = 29px)。
 * 顶层行是 sticky 的,需要精确的堆叠偏移,所以这里必须是定值 ——
 * 改 ROW 的纵向内边距或行高时,这个常量要跟着改。
 */
const TOP_ROW_PX = 29

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
 *
 * **顶层行是常驻的(sticky)**,这是被真实数据逼出来的设计:
 * 这个仓库 751 个文件挤在 `02_项目/脚本/History/<编号>/` 下面,`脚本` 有约 230 个子目录、
 * `History` 又有约 200 个 —— 打开一个深层文件自动展开祖先链之后,侧栏会变成 256 行、
 * 7400 多像素高,把「03_参考 / 04_资料 / 07读书 / README.md」推到 11 屏之外,
 * 看起来就像"只剩收集箱和项目两个文件夹"。
 *
 * 所以顶层不再嵌在可滚动内容里,而是钉在容器顶部(index * 行高 依次堆叠),
 * 展开的子级统一排在它们下面并独立滚动。这样无论展开多深,顶层目录永远点得到。
 */
export function DocTree({ root, currentPath, expanded, onToggle, onSelect, onHover }: Props) {
  const tops = root.children
  const openTops = tops.filter(n => n.isDir && expanded.has(n.path))

  return (
    <ul className="flex flex-col gap-px pb-2">
      {tops.map((node, i) => (
        <li key={node.path} className="sticky z-10" style={{ top: `${i * TOP_ROW_PX}px` }}>
          {node.isDir ? (
            <button
              type="button"
              className={`${ROW} bg-base-100 ${
                expanded.has(node.path) ? 'text-base-content/85' : 'text-base-content/70'
              } hover:bg-base-200`}
              onClick={() => onToggle(node.path)}
              aria-expanded={expanded.has(node.path)}
              title={node.path}
            >
              <Caret open={expanded.has(node.path)} />
              <span className="truncate font-medium">{node.name}</span>
              <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-base-content/35">
                {node.fileCount}
              </span>
            </button>
          ) : (
            <FileRow node={node} depth={0} currentPath={currentPath} onSelect={onSelect} onHover={onHover} />
          )}
        </li>
      ))}

      {/* 顶层下面的那一道分隔线:让常驻区与滚动区分开 */}
      {openTops.length > 0 && <li className="sticky z-10 border-b border-base-300" style={{ top: `${tops.length * TOP_ROW_PX}px` }} />}

      {openTops.map(node => (
        <li key={`group:${node.path}`} className="pt-1">
          <div className="truncate px-2 pb-1 text-[10px] uppercase tracking-wide text-base-content/35" title={node.path}>
            {node.name}
          </div>
          <ul className="flex flex-col gap-px">
            {node.children.map(child => (
              <TreeRow
                key={child.path}
                node={child}
                depth={1}
                currentPath={currentPath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

interface RowProps extends Omit<Props, 'root'> {
  node: TreeNode
  depth: number
}

function TreeRow({ node, depth, currentPath, expanded, onToggle, onSelect, onHover }: RowProps) {
  if (!node.isDir) return <FileRow node={node} depth={depth} currentPath={currentPath} onSelect={onSelect} onHover={onHover} />

  const open = expanded.has(node.path)
  return (
    <li>
      <button
        type="button"
        className={`${ROW} ${open ? 'text-base-content/85' : 'text-base-content/70'} hover:bg-base-200`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => onToggle(node.path)}
        aria-expanded={open}
        title={node.path}
      >
        <Caret open={open} />
        <span className="truncate font-medium">{node.name}</span>
        <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-base-content/35">{node.fileCount}</span>
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

function FileRow({
  node,
  depth,
  currentPath,
  onSelect,
  onHover,
}: {
  node: TreeNode
  depth: number
  currentPath: string | null
  onSelect: (path: string) => void
  onHover?: (path: string) => void
}) {
  const active = node.path === currentPath
  return (
    <button
      type="button"
      className={`${ROW} ${depth === 0 ? 'bg-base-100' : ''} ${
        active ? 'bg-primary/12 font-medium text-primary' : 'text-base-content/75 hover:bg-base-200'
      }`}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
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
  )
}
