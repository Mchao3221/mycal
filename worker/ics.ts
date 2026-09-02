// 极简 ICS(iCalendar)解析器 —— Workers 版
// 支持要点:行折叠、VALUE=DATE 全天、UTC(Z) 按 UTC 落日期、
// TZID/浮动时间按 UTC 近似(Workers 无本机时区概念)、
// 多日全天事件逐日展开(有上限)、RRULE 跳过并计数

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function dateKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 解析续行:以空格/Tab 开头的行并入上一行 */
export function unfoldLines(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

interface IcsDate {
  allDay: boolean
  date: Date
}

function parseIcsDate(value: string, params: Record<string, string>): IcsDate | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return {
      allDay: true,
      date: new Date(Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8))),
    }
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  // Workers 运行时无本机时区,统一按 UTC 墙钟处理(尾缀 Z 与否不影响)
  return {
    allDay: false,
    date: new Date(+y, +mo - 1, +d, +h, +mi, +s),
  }
}

export interface IcsEvent {
  uid: string | null
  summary: string | null
  start: IcsDate | null
  end: IcsDate | null
  hasRrule: boolean
}

/** 提取所有 VEVENT 的关键信息 */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let cur: IcsEvent | null = null
  for (const line of unfoldLines(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = { uid: null, summary: null, start: null, end: null, hasRrule: false }
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur)
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const segs = line.slice(0, idx).split(';')
    const value = line.slice(idx + 1)
    const name = segs[0].toUpperCase()
    const params: Record<string, string> = {}
    for (const s of segs.slice(1)) {
      const eq = s.indexOf('=')
      if (eq > -1) params[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1)
    }
    switch (name) {
      case 'UID':
        cur.uid = value.trim()
        break
      case 'SUMMARY':
        cur.summary = unescapeText(value)
        break
      case 'DTSTART':
        cur.start = parseIcsDate(value.trim(), params)
        break
      case 'DTEND':
        cur.end = parseIcsDate(value.trim(), params)
        break
      case 'RRULE':
        if (value.trim()) cur.hasRrule = true
        break
    }
  }
  return events
}

export interface ExpandedItem {
  uid: string
  dateKey: string
  text: string
}

export interface ExpandResult {
  items: ExpandedItem[]
  skippedRecurring: number
  outOfWindow: number
}

/** 把事件展开为逐日条目(窗口外跳过,返回统计供前端提示) */
export function expandEvents(
  events: IcsEvent[],
  { fromMs, toMs, maxSpanDays = 30, maxItems = 500 }: { fromMs: number; toMs: number; maxSpanDays?: number; maxItems?: number },
): ExpandResult {
  const items: ExpandedItem[] = []
  let skippedRecurring = 0
  let outOfWindow = 0

  for (const ev of events) {
    if (!ev.start) {
      outOfWindow++
      continue
    }
    if (ev.hasRrule) {
      skippedRecurring++
      continue
    }
    const start = ev.start.date
    if (start.getTime() < fromMs || start.getTime() > toMs) {
      outOfWindow++
      continue
    }
    const title = (ev.summary ?? '').trim() || '(无标题日程)'
    const uid = ev.uid || `nouid:${title}:${start.getTime()}`

    if (ev.start.allDay) {
      let endExclusive = ev.end?.allDay ? ev.end.date.getTime() : start.getTime() + 86_400_000
      if (endExclusive <= start.getTime()) endExclusive = start.getTime() + 86_400_000
      const spanDays = Math.min(maxSpanDays, Math.round((endExclusive - start.getTime()) / 86_400_000))
      for (let i = 0; i < spanDays && items.length < maxItems; i++) {
        const d = new Date(start.getTime() + i * 86_400_000)
        items.push({ uid, dateKey: dateKeyOf(d), text: title })
      }
    } else {
      if (items.length >= maxItems) break
      const time = `${pad2(start.getUTCHours())}:${pad2(start.getUTCMinutes())}`
      items.push({ uid, dateKey: dateKeyOf(start), text: `${time} ${title}` })
    }
  }

  return { items, skippedRecurring, outOfWindow }
}
