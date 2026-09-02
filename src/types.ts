export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  /** 由 .ics 订阅导入的日程 */
  source?: 'ics'
  /** ICS 事件 UID,用于重复导入去重 */
  uid?: string
}

/** 后端返回的存储结构:日期 key(YYYY-MM-DD) -> 当天条目 */
export type TodoStore = Record<string, Todo[]>

/** 日历圆点:local = 有本地待办(琥珀),ics = 仅 ICS 日程(蓝) */
export type DotKind = 'local' | 'ics'
