/** 与前端 src/types.ts 保持一致的条目结构 */
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

/** 全量存储结构:日期 key(YYYY-MM-DD) -> 当天条目 */
export type TodoStore = Record<string, Todo[]>

export interface TodoRow {
  id: string
  date_key: string
  text: string
  done: number
  created_at: number
  source: string | null
  uid: string | null
}
