import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { CodeView } from './CodeView'
import { ExternalView } from './ExternalView'
import { ImageView } from './ImageView'
import { MarkdownView } from './MarkdownView'
import { kindOf, rawUrl } from '../utils/fileKind'
import type { DocContent } from '../hooks/useDocs'

/**
 * epubjs 是「体积大、但绝大多数文件用不到」的依赖(自带 jszip / localforage 一大串),
 * 而这个仓库 752 个 SQL、27 个 md、1 个 epub —— 静态引入等于让每次打开阅读器都为它付首屏代价,
 * 所以按需加载。Markdown 与代码高亮是主力路径,保持同步引入。
 */
const EpubView = lazy(() => import('./EpubView').then(m => ({ default: m.EpubView })))

interface Props {
  /** null = 还没选文件 */
  path: string | null
  size: number
  /** 文本类文件的正文;二进制类型用不上 */
  content: DocContent
  knownPaths: Set<string>
}

/**
 * 阅读区:按文件类型分发到对应视图。
 * 同时用 ResizeObserver 量出可用尺寸给 epub / excalidraw 这类需要确定宽高的第三方渲染器。
 */
export function ReaderPane({ path, size, content, knownPaths }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!path) {
    return (
      <div ref={boxRef} className="grid h-full place-items-center text-center">
        <div className="text-sm text-base-content/45">
          <p className="mb-1 text-base text-base-content/60">从左侧目录选择一个文件开始阅读</p>
          <p className="mb-0 text-xs">内容直接来自 Gitee 仓库,本站只读</p>
        </div>
      </div>
    )
  }

  const kind = kindOf(path)

  return (
    <div ref={boxRef} className="h-full min-h-0">
      {kind === 'markdown' && (
        <TextView content={content} render={text => <MarkdownView path={path} text={text} size={size} knownPaths={knownPaths} />} />
      )}
      {kind === 'code' && <TextView content={content} render={text => <CodeView path={path} text={text} />} />}
      {kind === 'image' && <ImageView path={path} size={size} />}
      {kind === 'external' && <ExternalView path={path} size={size} />}
      {kind === 'epub' && (
        <Suspense fallback={<Loading label="正在加载电子书阅读器…" />}>
          <EpubView src={rawUrl(path)} title={path.split('/').pop() ?? path} width={box.width} height={box.height} />
        </Suspense>
      )}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center">
      <span className="inline-flex items-center gap-2 text-sm text-base-content/50">
        <span className="loading loading-spinner loading-sm" />
        {label}
      </span>
    </div>
  )
}

/** 文本类文件的加载中/失败两态,避免每个视图各写一遍 */
function TextView({ content, render }: { content: DocContent; render: (text: string) => ReactElement }) {
  if (content.status === 'ready') return render(content.text)
  if (content.status === 'error') {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-box border border-error/40 bg-error/5 px-4 py-3 text-center text-sm text-error">
          {content.message}
        </div>
      </div>
    )
  }
  return <Loading label="读取中…" />
}
