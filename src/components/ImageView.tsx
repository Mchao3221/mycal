import { useState } from 'react'
import { formatSize, rawUrl } from '../utils/fileKind'

interface Props {
  path: string
  size: number
  sha?: string
}

/** 图片直接显示;提供「适应宽度 / 原始尺寸」切换,大截图默认适应宽度更好看 */
export function ImageView({ path, size, sha }: Props) {
  const [failed, setFailed] = useState(false)
  const [actualSize, setActualSize] = useState(false)
  const url = rawUrl(path, sha)
  const name = path.split('/').pop() ?? path

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-1.5 text-xs text-base-content/50">
        <span>{formatSize(size)}</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs ml-auto"
          onClick={() => setActualSize(v => !v)}
          disabled={failed}
        >
          {actualSize ? '适应宽度' : '原始尺寸'}
        </button>
        <a className="btn btn-ghost btn-xs" href={url} target="_blank" rel="noopener noreferrer">
          新窗口打开
        </a>
      </div>

      <div className="panel-scroll grid min-h-0 flex-1 place-items-center overflow-auto p-6">
        {failed ? (
          <div className="text-center text-sm text-base-content/60">
            <p className="mb-0">图片加载失败</p>
            <p className="mt-1 font-mono text-xs text-base-content/40">{name}</p>
          </div>
        ) : (
          <img
            src={url}
            alt={name}
            onError={() => setFailed(true)}
            className={
              actualSize
                ? 'max-w-none'
                : 'max-h-full max-w-full object-contain'
            }
          />
        )}
      </div>
    </div>
  )
}
