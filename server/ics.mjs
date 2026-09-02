// 极简 ICS(iCalendar)解析器:满足个人订阅场景够用
// - 行折叠(RFC 5545 续行)
// - VALUE=DATE 全天事件
// - UTC(Z) 与本地时间转换(Z 按本机时区落日期)
// - TZID / 浮动时间按「本地墙钟」近似处理(个人日常使用足够,不做时区库换算)
// - 多日全天事件按天展开(有上限)
// - RRULE 重复规则:不展开,计数后由调用方提示(列为后续增强)

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function dateKeyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 解析续行:以空格/Tab 开头的行并入上一行 */
export function unfoldLines(text) {
  const lines = []
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

function unescapeText(s) {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseIcsDate(value, params) {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return {
      allDay: true,
      date: new Date(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8)),
    }
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (z === 'Z') {
    return { allDay: false, date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) }
  }
  // TZID / 浮动时间:按本地墙钟近似
  return { allDay: false, date: new Date(+y, +mo - 1, +d, +h, +mi, +s) }
}

/** 提取所有 VEVENT 的关键信息 */
export function parseIcs(text) {
  const events = []
  let cur = null
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
    const params = {}
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

/**
 * 把事件展开为逐日条目。
 * 窗口:[fromMs, toMs] 之外的事件不计入;返回统计供前端提示。
 */
export function expandEvents(events, { fromMs, toMs, maxSpanDays = 30, maxItems = 500 }) {
  const items = []
  let skippedRecurring = 0
  let outOfWindow = 0

  for (const ev of events) {
    if (!ev.start || !ev.start.date) {
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
      // 全天事件:DTEND 为独占端点,缺省即单日
      let endExclusive = ev.end?.allDay ? ev.end.date.getTime() : start.getTime() + 86_400_000
      if (endExclusive <= start.getTime()) endExclusive = start.getTime() + 86_400_000
      const spanDays = Math.min(maxSpanDays, Math.round((endExclusive - start.getTime()) / 86_400_000))
      for (let i = 0; i < spanDays && items.length < maxItems; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        items.push({ uid, dateKey: dateKeyOf(d), text: title })
      }
    } else {
      if (items.length >= maxItems) break
      const time = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
      items.push({ uid, dateKey: dateKeyOf(start), text: `${time} ${title}` })
    }
  }

  return { items, skippedRecurring, outOfWindow }
}
