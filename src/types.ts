// 注:v0.4.1 起日程功能(todos/ICS)已整体移除。

// ---------- 访问码锁 ----------

export interface LockStatus {
  /** 是否已设置访问码(未设置先走设置流程) */
  isSet: boolean
  unlocked: boolean
}

// ---------- 当日流水 ----------

/** 事后记录「今天做了哪些事」,多条时间序,供 AI 汇总消化 */
export interface JournalEntry {
  id: string
  text: string
  createdAt: number
}

export type JournalStore = Record<string, JournalEntry[]>

// ---------- 体重记录 ----------

/** 一天一条,同日再录即覆盖(口径:晨起空腹) */
export interface WeightEntry {
  dateKey: string
  weightKg: number
  updatedAt: number
}

export type WeightStore = Record<string, WeightEntry>

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
  /** 当前体重:由最新体重记录推导(档案不再手动填);无任何记录时为 null */
  weightKg: number | null
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
  /** 汇总时采用的有效体重 */
  weightKg?: number | null
}
