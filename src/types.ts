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

/** 日历圆点:event = 有 ICS 日程(蓝),todo = 有本地待办(琥珀),health = 有打卡(绿) */
export type DotMark = 'event' | 'todo' | 'health'

// ---------- 打卡日记 ----------

export type HealthKind = 'diet' | 'exercise'
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface HealthLog {
  id: string
  kind: HealthKind
  text: string
  /** 仅 diet 有 */
  meal?: MealSlot
  /** 千卡;null = 待 AI 估算 */
  kcal: number | null
  /** kcal 非空时有值:手动录入/修正,或 AI 估算 */
  kcalSource?: 'ai' | 'manual'
  createdAt: number
}

export interface HealthLogInput {
  kind: HealthKind
  text: string
  meal?: MealSlot | null
  kcal?: number | null
}

export type HealthStore = Record<string, HealthLog[]>

// ---------- 健康档案 ----------

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high'
export type Goal = 'lose' | 'maintain' | 'gain'

export interface Profile {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  weightKg: number
  targetWeightKg: number | null
  activity: ActivityLevel
  goal: Goal
  updatedAt: number
}

// ---------- AI ----------

export interface AiConfigInfo {
  baseUrl: string
  model: string
  hasKey: boolean
}

export interface AiSummary {
  dateKey: string
  generatedAt: number
  model: string
  /** 摄入合计 */
  intakeKcal: number
  /** 运动消耗合计 */
  exerciseKcal: number
  bmr: number
  tdee: number
  /** 结合目标的建议摄入 */
  targetKcal: number
  /** 总消耗 = TDEE + 运动 */
  burnKcal: number
  /** 净差 = 摄入 - 总消耗,负数为亏空 */
  netKcal: number
  /** 净差折算体重(≈7700 kcal/kg),负=掉秤 */
  weightDeltaKg: number
  /** AI 也没估出热量的条数 */
  pendingCount: number
  comment: string
}
