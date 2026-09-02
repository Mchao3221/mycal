// 生成 docs/ui-sketch.excalidraw
// 用法: npm run sketch
// 场景变更时改这里再重新生成,保持草图可重建。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, '../docs/ui-sketch.excalidraw')

/** 文本元素:宽高按 fontSize 粗略估算 */
function text(id, x, y, content, fontSize = 16, strokeColor = '#1e1e1e') {
  const lines = content.split('\n')
  return {
    type: 'text',
    id,
    x,
    y,
    width: Math.max(...lines.map(l => l.length)) * fontSize * 0.6,
    height: lines.length * fontSize * 1.25,
    text: content,
    fontSize,
    strokeColor,
  }
}

/** 矩形 */
function rect(id, x, y, w, h, opts = {}) {
  return {
    type: 'rectangle',
    id,
    x,
    y,
    width: w,
    height: h,
    strokeColor: '#1e1e1e',
    ...(opts.rounded ? { roundness: { type: 3 } } : {}),
    ...(opts.bg ? { backgroundColor: opts.bg, fillStyle: 'solid' } : {}),
    ...opts,
  }
}

const els = []
const push = (...items) => els.push(...items)

// ===== 标题 =====
push(text('title', 330, 40, 'MyCal v0.2 界面草图:SQLite + ICS 订阅', 24))

// ===== ICS 导入条 =====
push(text('lbl-ics', 90, 100, '导入 .ics 链接', 16, '#757575'))
push(rect('ics-input', 230, 92, 330, 34, { rounded: true, bg: '#e8f2fe' }))
push(text('ics-ph', 245, 100, 'https://…/calendar.ics', 14, '#757575'))
push(rect('ics-btn', 575, 92, 70, 34, { rounded: true, bg: '#a5d8ff' }))
push(text('ics-btn-t', 590, 100, '导入', 16))
push(
  text(
    'ics-hint',
    90,
    136,
    '结果: 导入 12 条 · 跳过重复 3 条 · 重复规则未展开 2 条',
    14,
    '#757575',
  ),
)

// ===== 日历卡 =====
push(rect('cal-card', 80, 180, 380, 400, { rounded: true }))
push(text('cal-title', 110, 200, '2025年11月', 20))
push(rect('btn-prev', 330, 196, 28, 28, { rounded: true }))
push(text('btn-prev-t', 338, 200, '‹', 16))
push(rect('btn-next', 364, 196, 28, 28, { rounded: true }))
push(text('btn-next-t', 372, 200, '›', 16))
push(rect('btn-today', 300, 232, 56, 26, { rounded: true, bg: '#a5d8ff' }))
push(text('btn-today-t', 312, 237, '今天', 14))

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
weekdays.forEach((w, i) => {
  push(text(`wd-${i}`, 112 + i * 47, 232, w, 14, '#757575'))
})

// 6x7 网格,26 号选中,12 号有本地待办(琥珀点),19 号仅 ICS(蓝点)
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 7; c++) {
    const day = r * 7 + c - 2 // 10月27日起
    if (day < 1 || day > 30) continue
    const x = 96 + c * 47
    const y = 260 + r * 60
    const selected = day === 26
    push(
      rect(
        `cell-${r}-${c}`,
        x,
        y,
        40,
        50,
        selected ? { rounded: true, bg: '#a5d8ff' } : { rounded: true },
      ),
    )
    push(text(`cell-t-${r}-${c}`, x + 14, y + 8, String(day), 14, selected ? '#1e1e1e' : '#495057'))
    if (day === 12) push({ type: 'ellipse', id: `dot-l-${day}`, x: x + 17, y: y + 40, width: 6, height: 6, backgroundColor: '#f59e0b', fillStyle: 'solid', strokeColor: '#f59e0b' })
    if (day === 19) push({ type: 'ellipse', id: `dot-i-${day}`, x: x + 17, y: y + 40, width: 6, height: 6, backgroundColor: '#4a9eed', fillStyle: 'solid', strokeColor: '#4a9eed' })
  }
}

push(text('legend', 96, 556, '● 琥珀=本地待办   ● 蓝=ICS日程   蓝=选中', 14, '#757575'))

// ===== 待办面板 =====
push(rect('panel', 520, 180, 320, 400, { rounded: true }))
push(text('panel-title', 545, 200, '11月26日 · 周三', 20))
push(text('panel-stats', 545, 232, '共 3 项 · 完成 1 项', 14, '#757575'))

push(rect('cb1', 545, 262, 16, 16, { bg: '#b2f2bb' }))
push(text('t1', 570, 262, '写周报', 14, '#757575'))
push({ type: 'line', id: 'strike1', x: 568, y: 270, width: 50, height: 0, points: [[0, 0], [50, 0]], strokeColor: '#757575', strokeWidth: 1 })
push(text('badge-ics', 640, 262, '日程', 12, '#1d6fd1'))
push(rect('cb2', 545, 296, 16, 16))
push(text('t2', 570, 296, '给客户回邮件', 14))
push(rect('cb3', 545, 330, 16, 16))
push(text('t3', 570, 330, '14:30 项目评审会', 14))
push(text('badge-ics2', 710, 330, '日程', 12, '#1d6fd1'))

push(rect('input', 545, 520, 190, 32, { rounded: true }))
push(text('input-ph', 558, 528, '新待办…回车添加', 14, '#757575'))
push(rect('add-btn', 745, 520, 70, 32, { rounded: true, bg: '#a5d8ff' }))
push(text('add-btn-t', 760, 528, '添加', 14))

// ===== 注释 =====
push(text('note-db', 90, 620, '数据: 本地 SQLite (data/mycal.db) ←→ REST API ←→ React', 16, '#2563eb'))
push(text('note-file', 90, 650, '草图: 本文件由 scripts/build-sketch.mjs 生成 (npm run sketch)', 14, '#757575'))

// ===== 绑定线:点26号 -> 面板 =====
push({
  type: 'arrow',
  id: 'link',
  x: 236,
  y: 500,
  width: 300,
  height: -40,
  points: [[0, 0], [300, -40]],
  strokeColor: '#4a9eed',
  strokeWidth: 2,
  endArrowhead: 'arrow',
})

const doc = {
  type: 'excalidraw',
  version: 2,
  source: 'mycal/scripts/build-sketch.mjs',
  elements: els,
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
  files: {},
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8')
console.log(`written: ${outPath} (${els.length} elements)`)
