// localStorage 薄封装。
// 阅读进度、目录展开状态、栏宽、主题这类纯本地偏好都放这里 —— 项目已决定不为此引入 D1,
// 所以刷新/重开浏览器能恢复,但换设备不同步。
// 统一加 'mydocs:' 前缀,避免和同域下别的应用撞 key。
const PREFIX = 'mydocs:'

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    // 隐私模式禁用 localStorage、或历史数据被改坏时,一律回退默认值,不让它冒泡成白屏
    return fallback
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* 配额满或被禁用时忽略:偏好丢失不影响阅读 */
  }
}

export function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    /* 同上 */
  }
}
