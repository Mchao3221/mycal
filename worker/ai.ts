// AI 每日汇总:估算缺失热量 + 结合健康档案(BMR/TDEE)写点评。
// 只依赖 Web API 与 worker/db.ts,可在 Workers 运行时直接执行。
import {
  fillKcalIfNull,
  getHealthLogsByDate,
  getJournalByDate,
  getProfile,
  getRecentWeights,
  getSetting,
  upsertAiSummary,
} from './db'
import type { Env } from './env'
import type { AiSummary, HealthLog, Profile } from './types'

/** 路由层统一转 { error } + 状态码 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const MEAL_LABEL: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }
const GOAL_LABEL: Record<string, string> = { lose: '减脂', maintain: '保持', gain: '增肌' }
const SEX_LABEL: Record<string, string> = { male: '男', female: '女' }

/** 日常活动系数(不含刻意运动;运动打卡单独计) */
export const ACTIVITY_FACTOR: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
}

/**
 * Mifflin-St Jeor 公式估算 BMR / TDEE / 建议摄入。
 * targetKcal:减脂 = TDEE-400(不低于 BMR),增肌 = TDEE+300,保持 = TDEE。
 */
export function calcEnergy(p: Profile | null): { bmr: number; tdee: number; targetKcal: number } {
  if (!p || !p.sex || !p.age || !p.heightCm || !p.weightKg) {
    throw new HttpError(400, '请先在「档案」里填齐性别、年龄、身高(体重取最新体重记录)')
  }
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  const bmr = Math.round(p.sex === 'male' ? base + 5 : base - 161)
  const factor = ACTIVITY_FACTOR[p.activity] ?? ACTIVITY_FACTOR.light
  const tdee = Math.round(bmr * factor)
  let target = tdee
  if (p.goal === 'lose') target = Math.max(bmr, tdee - 400)
  if (p.goal === 'gain') target = tdee + 300
  return { bmr, tdee, targetKcal: Math.round(target) }
}

/** 配置优先级:settings 表 > 环境变量(secret)> 默认 */
export async function resolveAiConfig(db: Env['mycalDB'], env: Env) {
  const [baseUrl, model, apiKey] = await Promise.all([
    getSetting(db, 'ai.baseUrl'),
    getSetting(db, 'ai.model'),
    getSetting(db, 'ai.apiKey'),
  ])
  return {
    baseUrl: baseUrl || env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: model || env.AI_MODEL || 'gpt-4o-mini',
    apiKey: apiKey || env.AI_API_KEY || '',
  }
}

type AiConfig = Awaited<ReturnType<typeof resolveAiConfig>>

/** 从模型回复中稳健地抠出 JSON 对象(容忍 ```json 围栏与前后废话) */
export function extractJson(text: string): unknown {
  let t = String(text ?? '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('未在回复中找到 JSON 对象')
  return JSON.parse(t.slice(start, end + 1))
}

async function chatCompletion(cfg: AiConfig, messages: { role: string; content: string }[]): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, temperature: 0.3, messages }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    throw new HttpError(502, `AI 服务请求失败:${err instanceof Error ? err.message : String(err)}`)
  }
  if (!resp.ok) {
    const body = (await resp.text().catch(() => '')).slice(0, 200)
    throw new HttpError(502, `AI 服务返回 HTTP ${resp.status}${body ? `:${body}` : ''}`)
  }
  const data = (await resp.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
  } | null
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new HttpError(502, 'AI 服务返回内容为空')
  }
  return content
}

/**
 * 生成(或重新生成)某天的 AI 汇总:
 * 1. 前置:当天有打卡或流水记录、档案齐全、API Key 已配置;
 * 2. 一次 chat 调用:估算缺热量条目(只回填空值)+ 结合打卡/流水/体重写中文点评;
 * 3. 服务端确定性计算收支(体重优先用最新体重记录),结果落库缓存。
 */
export async function summarizeDay(db: Env['mycalDB'], env: Env, dateKey: string): Promise<AiSummary> {
  const logs = await getHealthLogsByDate(db, dateKey)
  const journal = await getJournalByDate(db, dateKey)
  if (!logs.length && !journal.length) throw new HttpError(400, '这天还没有任何记录,先记几笔吧')

  const profile = await getProfile(db)
  if (!profile) throw new HttpError(400, '请先在「档案」里填齐性别、年龄、身高')
  // 有效体重:优先当天(或最近)的体重记录,回退档案手动值 —— 单一事实源
  const recentWeights = await getRecentWeights(db, dateKey, 7)
  const latest = recentWeights[recentWeights.length - 1]
  const effWeight = latest?.weightKg ?? profile.weightKg
  if (!effWeight) throw new HttpError(400, '请先在「今日体重」记一笔,或在「档案」里填写体重')
  const energy = calcEnergy({ ...profile, weightKg: effWeight })
  const cfg = await resolveAiConfig(db, env)
  if (!cfg.apiKey) {
    throw new HttpError(400, '尚未配置 AI 服务,请点击顶栏「AI」填写 Base URL / API Key / 模型')
  }

  const pending = logs.filter(l => l.kcal == null)
  const itemsForAi = logs.map(l => ({
    id: l.id,
    type: l.kind === 'diet' ? '饮食(摄入)' : '运动(消耗)',
    ...(l.kind === 'diet' && l.meal ? { 餐次: MEAL_LABEL[l.meal] ?? l.meal } : {}),
    内容: l.text,
    ...(l.kcal != null ? { 已知千卡: l.kcal } : {}),
  }))

  const weight7dAvg = recentWeights.length
    ? Math.round((recentWeights.reduce((s, w) => s + w.weightKg, 0) / recentWeights.length) * 10) / 10
    : null

  const system = [
    '你是 MyCal 应用中的营养师兼健康记录助手。用户会给你某天的健康档案、热量参数、打卡条目(饮食=摄入,运动=消耗),以及当天记下的流水(做了哪些事)。',
    '任务一 estimates:为「待估算 id 列表」中的每一条估一个合理千卡数,取常见份量的中位数,结合文字里的份量描述,只输出正整数;列表以外的 id 一律不得出现,列表为空则输出空数组。',
    '任务二 comment:150 字以内的中文点评。结合基础代谢、总消耗、建议摄入,说明今日摄入与消耗的平衡情况、与目标的方向是否一致;并参考当日流水与体重(含近 7 日均值,日常波动多为水分),给一条具体可执行的改进建议(如蛋白质、蔬菜、饮水、加餐时机、久坐打断)。语气友好直接,不用 Markdown,不堆砌客套话。',
    '只输出一个 JSON 对象,不要任何解释,格式:{"estimates":[{"id":"...","kcal":420}],"comment":"..."}',
  ].join('\n')

  const user = JSON.stringify({
    日期: dateKey,
    档案: {
      性别: SEX_LABEL[profile.sex] ?? '',
      年龄: profile.age,
      身高cm: profile.heightCm,
      体重kg: effWeight,
      ...(weight7dAvg ? { 近7日均重kg: weight7dAvg } : {}),
      ...(profile.targetWeightKg ? { 目标体重kg: profile.targetWeightKg } : {}),
      目标: GOAL_LABEL[profile.goal] ?? '保持',
    },
    热量参数: { 基础代谢: energy.bmr, 日常总消耗TDEE: energy.tdee, 建议摄入: energy.targetKcal },
    当日条目: itemsForAi,
    ...(journal.length ? { 当日流水: journal.map(j => j.text) } : {}),
    待估算id列表: pending.map(l => l.id),
  })

  let parsed: { estimates?: unknown; comment?: unknown }
  try {
    parsed = extractJson(
      await chatCompletion(cfg, [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]),
    ) as { estimates?: unknown; comment?: unknown }
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, `解析 AI 回复失败:${err instanceof Error ? err.message : String(err)}`)
  }

  // 回填估算值:只认待估算列表内的 id,数值限 1~20000
  const pendingIds = new Set(pending.map(l => l.id))
  const estimates = Array.isArray(parsed?.estimates) ? (parsed.estimates as { id?: unknown; kcal?: unknown }[]) : []
  for (const e of estimates) {
    if (!e || typeof e !== 'object') continue
    const kcal = Number(e.kcal)
    if (!pendingIds.has(String(e.id)) || !Number.isFinite(kcal)) continue
    await fillKcalIfNull(db, String(e.id), Math.min(20000, Math.max(1, Math.round(kcal))))
  }

  // 以回填后的库内数据计算总量(缺估条目计 0 并单独提示)
  const fresh: HealthLog[] = await getHealthLogsByDate(db, dateKey)
  let intakeKcal = 0
  let exerciseKcal = 0
  let pendingCount = 0
  for (const l of fresh) {
    if (l.kcal == null) {
      pendingCount++
      continue
    }
    if (l.kind === 'diet') intakeKcal += l.kcal
    else exerciseKcal += l.kcal
  }

  const burnKcal = energy.tdee + exerciseKcal
  const netKcal = intakeKcal - burnKcal
  const summary: AiSummary = {
    dateKey,
    generatedAt: Date.now(),
    model: cfg.model,
    intakeKcal,
    exerciseKcal,
    bmr: energy.bmr,
    tdee: energy.tdee,
    targetKcal: energy.targetKcal,
    burnKcal,
    netKcal,
    // 净差折算法:1 kg 脂肪 ≈ 7700 kcal(负=亏空)
    weightDeltaKg: Math.round((netKcal / 7700) * 1000) / 1000,
    pendingCount,
    comment:
      typeof parsed?.comment === 'string' && parsed.comment.trim()
        ? parsed.comment.trim().slice(0, 2000)
        : '(AI 未返回点评)',
    weightKg: effWeight,
  }
  return upsertAiSummary(db, dateKey, summary)
}
