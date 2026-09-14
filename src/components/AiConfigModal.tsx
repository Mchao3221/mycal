import { useEffect, useState } from 'react'
import type { AiConfigInfo } from '../types'
import { api } from '../utils/api'

interface Props {
  open: boolean
  onClose: () => void
  notify: (kind: 'success' | 'error', text: string) => void
}

/**
 * AI 服务配置(OpenAI 兼容):baseUrl + model + apiKey。
 * 密钥只写不读:接口 GET 永远不返回 key,回显仅提示「已配置」。
 */
export function AiConfigModal({ open, onClose, notify }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    api<AiConfigInfo>('/api/ai/config')
      .then(c => {
        setBaseUrl(c.baseUrl)
        setModel(c.model)
        setHasKey(c.hasKey)
      })
      .catch(err => notify('error', `加载 AI 配置失败:${err instanceof Error ? err.message : err}`))
      .finally(() => setLoaded(true))
  }, [open, notify])

  if (!open) return null

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const c = await api<AiConfigInfo>('/api/ai/config', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl, model, apiKey }),
      })
      setHasKey(c.hasKey)
      setApiKey('')
      setBaseUrl(c.baseUrl)
      setModel(c.model)
      notify('success', c.hasKey ? 'AI 服务已配置' : '已保存,尚未设置 API Key')
      onClose()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async () => {
    if (saving) return
    setSaving(true)
    try {
      const c = await api<AiConfigInfo>('/api/ai/config', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: '' }),
      })
      setHasKey(c.hasKey)
      setApiKey('')
      notify('success', 'API Key 已清除')
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="AI 服务设置">
      <div className="modal-box">
        <h3 className="text-lg font-semibold">AI 服务设置</h3>
        <p className="mt-1 text-sm text-base-content/55">
          任何 OpenAI 兼容服务均可(OpenAI / DeepSeek / Kimi / 本地 Ollama 等),仅存本机。
        </p>

        {!loaded ? (
          <div className="py-8 text-center">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={e => {
              e.preventDefault()
              void submit()
            }}
          >
            <label className="form-control">
              <span className="label-text mb-1 text-xs text-base-content/55">Base URL</span>
              <input
                className="input input-bordered w-full font-mono text-sm"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="form-control">
              <span className="label-text mb-1 text-xs text-base-content/55">模型</span>
              <input
                className="input input-bordered w-full font-mono text-sm"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </label>
            <label className="form-control">
              <span className="label-text mb-1 flex items-center gap-2 text-xs text-base-content/55">
                API Key
                {hasKey && <span className="badge badge-success badge-sm">已配置</span>}
              </span>
              <input
                className="input input-bordered w-full font-mono text-sm"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey ? '留空则保持不变' : 'sk-…(输入新值以覆盖)'}
                autoComplete="off"
              />
              {hasKey && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs mt-1 self-start text-error"
                  onClick={() => void clearKey()}
                  disabled={saving}
                >
                  ✕ 清除已存密钥
                </button>
              )}
            </label>

            <div className="modal-action">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
    </div>
  )
}
