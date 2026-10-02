import { useState } from 'react'
import { extOf, formatSize, rawUrl } from '../utils/fileKind'

interface Props {
  path: string
  size: number
}

/**
 * pptx / xlsx / zip 这类浏览器无法内联渲染的二进制文件。
 * 不做在线预览,只给一个明确的入口:新窗口打开,之后是预览还是下载交给浏览器自己决定。
 * 之所以要用按钮(而不是选中文件就自动 window.open):浏览器只认「用户手势」触发的弹窗,
 * 由状态更新后的 effect 去开会直接被拦截,所以必须留一个真实的点击动作。
 */
export function ExternalView({ path, size }: Props) {
  const [copied, setCopied] = useState(false)
  const url = rawUrl(path)
  const name = path.split('/').pop() ?? path
  const dir = path.split('/').slice(0, -1).join('/')

  const openInNewTab = () => {
    // noopener:新窗口拿不到本页的 window.opener,避免被反向控制
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 非 https 或用户拒绝剪贴板权限时静默失败,不打断阅读
      setCopied(false)
    }
  }

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-md rounded-box border border-base-300 bg-base-100 p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-box bg-base-200 font-mono text-xs font-semibold uppercase text-base-content/60">
          {extOf(path) || 'bin'}
        </div>
        <p className="mb-0 break-all text-sm font-medium">{name}</p>
        {dir && <p className="mb-0 mt-1 break-all font-mono text-[11px] text-base-content/40">{dir}</p>}
        <p className="mb-0 mt-2 text-xs text-base-content/50">{formatSize(size)} · 无法内联预览</p>

        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={openInNewTab}>
            在新窗口打开
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
      </div>
    </div>
  )
}
