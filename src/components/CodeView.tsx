import { useMemo } from 'react'
import { highlightCode, languageOf } from '../utils/highlight'

interface Props {
  /** 仓库内路径,用于推断语言 */
  path: string
  text: string
}

/** 超过这个体积就不再着色:600KB 的导出脚本交给 hljs 会卡住主线程一秒以上 */
const HIGHLIGHT_SIZE_GUARD = 400_000

/**
 * 文本/源码只读视图(SQL 是这个仓库的绝对主力,752 个文件)。
 *
 * 行号不靠切分高亮后的 HTML(hljs 会产出跨行的 span,切开就破坏了标记),
 * 而是用一个并行的高度对齐的 gutter 承载,两列共享同一套行高(--code-line-height)。
 */
export function CodeView({ path, text }: Props) {
  // 注意:必须用 languageOf(扩展名 → hljs 语言名),不能直接把扩展名当语言名传进去,
  // 否则 .ts / .yml 这些「扩展名与语言名不同」的文件会被静默降级成纯文本。
  const lang = languageOf(path)
  const { html, plain } = useMemo(() => highlightCode(text, lang, HIGHLIGHT_SIZE_GUARD), [text, lang])
  const lineCount = useMemo(() => {
    // 末尾换行不额外算一行,避免行号比内容多一个
    let n = 1
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
    return text.endsWith('\n') ? n - 1 : n
  }, [text])

  const skipped = plain && text.length > HIGHLIGHT_SIZE_GUARD

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-1.5 text-xs text-base-content/50">
        <span className="tabular-nums">{lineCount} 行</span>
        <span className="text-base-content/25">·</span>
        <span>{lang ?? '纯文本'}</span>
        {skipped && (
          <>
            <span className="text-base-content/25">·</span>
            <span className="text-warning">文件较大,已跳过语法高亮</span>
          </>
        )}
        <a
          className="btn btn-ghost btn-xs ml-auto"
          href={`/api/docs/raw?path=${encodeURIComponent(path)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          新窗口打开
        </a>
      </div>

      <div className="code-scroll panel-scroll flex min-h-0 flex-1 overflow-auto">
        <div className="code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className="code-pre">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  )
}
