// ---------- 打卡日记 ----------

export type HealthKind = 'diet' | 'exercise'
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface HealthLog {
  id: string
  kind: HealthKind
  text: string
  meal?: MealSlot
  /** 千卡;null = 待 AI 估算 */
  kcal: number | null
  /** kcal 非空时有值 */
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

export interface HealthLogRow {
  id: string
  date_key: string
  kind: string
  text: string
  meal: string | null
  kcal: number | null
  kcal_source: string | null
  created_at: number
}

// ---------- 当日流水(v0.4) ----------

/** 事后记录"今天做了哪些事",多条时间序,供 AI 汇总消化 */
export interface JournalEntry {
  id: string
  text: string
  createdAt: number
}

export type JournalStore = Record<string, JournalEntry[]>

export interface JournalRow {
  id: string
  date_key: string
  text: string
  created_at: number
}

// ---------- 体重记录(v0.4) ----------

/** 一天一条,同日再录即覆盖(口径:晨起空腹) */
export interface WeightEntry {
  dateKey: string
  weightKg: number
  updatedAt: number
}

export type WeightStore = Record<string, WeightEntry>

export interface WeightRow {
  date_key: string
  weight_kg: number
  updated_at: number
}

// ---------- 登录会话(v0.4) ----------

export interface SessionRow {
  token_hash: string
  label: string | null
  created_at: number
  expires_at: number
}

// ---------- 健康档案 ----------

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high'
export type Goal = 'lose' | 'maintain' | 'gain'

export interface Profile {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  /** 当前体重:优先由体重记录推导,档案本身可为 null */
  weightKg: number | null
  targetWeightKg: number | null
  activity: ActivityLevel
  goal: Goal
  updatedAt: number
}

export interface ProfileRow {
  sex: string | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  target_weight_kg: number | null
  activity: string | null
  goal: string | null
  updated_at: number | null
}

// ---------- AI 每日汇总 ----------

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
  /** 汇总时采用的有效体重(最新体重记录,缺省回退档案) */
  weightKg?: number | null
}
