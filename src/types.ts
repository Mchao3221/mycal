export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
}

/** localStorage 中的存储结构:日期 key(YYYY-MM-DD) -> 当天待办 */
export type TodoStore = Record<string, Todo[]>
