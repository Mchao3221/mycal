// Mermaid 图形渲染。
//
// 整个模块走动态 import: mermaid 及其依赖(dagre / cytoscape / katex 等)有好几 MB,
// 而带 mermaid 图的文档通常只是少数几篇,只有真的遇到 mermaid 代码块才值得下载。
//
// 尺寸策略(对应「不要大到一屏幕看不完,也不要小到看不清」):
//   1. 先按阅读区宽度等比缩放,让它放得下;
//   2. 高度再压到视口的一个比例内,保证一屏能看全;
//   3. 但缩放有下限 —— 触底后不再继续缩,改为容器内滚动,并允许点击切回原始尺寸。
//      宁可让用户滚两下,也不把图缩成看不清的小字。
//   4. 小图不做放大(放大只会变糊),保持 mermaid 算出来的原始尺寸。

const MIN_SCALE = 0.55
/** 图形最多占视口高度的多少 —— 留出边距,保证"一屏能看完" */
const MAX_VIEWPORT_HEIGHT_RATIO = 0.66
/** 兜底的自然尺寸,仅当 mermaid 没给 viewBox 且量不出宽高时使用 */
const FALLBACK_WIDTH = 800
const FALLBACK_HEIGHT = 600

type MermaidTheme = 'light' | 'dark'

let modPromise: Promise<typeof import('mermaid')> | null = null
let initedTheme: MermaidTheme | null = null

async function loadMermaid(theme: MermaidTheme) {
  if (!modPromise) modPromise = import('mermaid')
  const mermaid = (await modPromise).default
  if (initedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // strict:标签内容交由 mermaid 自己做消毒,并禁用图内点击事件。
      // 图源虽然来自自己的仓库,但渲染结果要 innerHTML 进页面,仍按不可信内容对待。
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      // 与全站字体保持一致(等宽优先,中文回退;不要放 system-ui,否则图里的英文会变 proportional)
      fontFamily: '"Maple Mono NF CN", ui-monospace, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
      themeVariables: { fontSize: '16px' },
      // useMaxWidth 全部关掉:缩放由下面的 fitBlock 接管,
      // 否则 mermaid 会往 svg 上写 width:100%,和我们的显式尺寸打架。
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      state: { useMaxWidth: false },
      pie: { useMaxWidth: false },
      er: { useMaxWidth: false },
    })
    initedTheme = theme
  }
  return mermaid
}

/** 把一段 mermaid 源码渲染成 SVG 字符串 */
async function renderSvg(source: string, theme: MermaidTheme): Promise<string> {
  const mermaid = await loadMermaid(theme)
  const id = `mmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const { svg } = await mermaid.render(id, source)
  return svg
}

/** 当前应用主题(daisyUI 把主题名写在 <html data-theme>) */
export function currentMermaidTheme(): MermaidTheme {
  return document.documentElement.dataset.theme === 'dim' ? 'dark' : 'light'
}

/**
 * 算出该把图缩到多少。抽成纯函数是为了能脱离 DOM 单独验证 ——
 * 「一屏放得下」和「不能小到看不清」这两条要求最后都落在这个算式上。
 *
 * 两条要求天然会打架(一张 2400×1900 的图不可能既完整显示又保持原字号),
 * 所以定了一个明确的优先级,而不是简单夹在中间:
 *   1. **横向永不溢出** —— 阅读是纵向的,横向滚动条是最难受的体验;
 *   2. 其次尽量让整张图落在一屏内(宽高同时约束,取更严的那个);
 *   3. 最后才守可读下限:高度实在放不下时,允许纵向滚动,但字号不再往小缩。
 * 上限 1:小图不放大,放大只会让矢量图也发糊、还白占版面。
 *
 * 返回值 clamped = "已经触到可读下限,可能需要在容器里纵向滚动",
 * 调用方据此加提示样式并把对齐方式改成左上,避免开头被居中留白藏住。
 */
export function computeFitScale(
  natW: number,
  natH: number,
  availW: number,
  maxH: number,
  minScale: number = MIN_SCALE,
): { scale: number; clamped: boolean } {
  if (!(natW > 0) || !(natH > 0) || !(availW > 0) || !(maxH > 0)) return { scale: 1, clamped: false }

  const scaleW = Math.min(availW / natW, 1)
  const scaleH = Math.min(maxH / natH, 1)

  let scale = Math.min(scaleW, scaleH)
  let clamped = false
  if (scale < minScale) {
    clamped = true
    // 顶到可读下限,但绝不超过 scaleW —— 这一条保证了横向一定放得下
    scale = Math.min(scaleW, minScale)
  }
  return { scale, clamped }
}

/**
 * 让图在一个屏幕内放得下。
 * natural 尺寸取自 viewBox —— mermaid 一定会写它,而且它不受当前 CSS 尺寸影响。
 */
function fitBlock(block: HTMLElement, maxHeight: number, useNatural: boolean): void {
  const svg = block.querySelector<SVGSVGElement>('.mermaid-canvas svg')
  const canvas = block.querySelector<HTMLElement>('.mermaid-canvas')
  if (!svg || !canvas) return

  const vb = svg.viewBox?.baseVal
  const natW = vb && vb.width > 0 ? vb.width : Number(svg.getAttribute('width')) || FALLBACK_WIDTH
  const natH = vb && vb.height > 0 ? vb.height : Number(svg.getAttribute('height')) || FALLBACK_HEIGHT

  // canvas 的可用宽度:clientWidth 含内边距,要减掉,否则会算出略微溢出、出现横向滚动条
  const cs = getComputedStyle(canvas)
  const inner =
    canvas.clientWidth - (Number.parseFloat(cs.paddingLeft) || 0) - (Number.parseFloat(cs.paddingRight) || 0)
  const availW = Math.max(160, inner || block.clientWidth || FALLBACK_WIDTH)

  const { scale, clamped } = useNatural
    ? { scale: 1, clamped: false }
    : computeFitScale(natW, natH, availW, maxHeight)

  svg.setAttribute('width', String(Math.round(natW * scale)))
  svg.setAttribute('height', String(Math.round(natH * scale)))
  // 清掉 mermaid 可能写上的行内 max-width,免得和显式尺寸打架
  svg.style.maxWidth = 'none'
  svg.style.height = 'auto'

  block.classList.toggle('is-oversized', clamped)
  block.classList.toggle('is-natural', useNatural)
  block.dataset.mermaidScale = scale.toFixed(2)
}

function viewportLimit(): number {
  return Math.max(240, Math.round(window.innerHeight * MAX_VIEWPORT_HEIGHT_RATIO))
}

/** 点击图:在「适应」与「原始尺寸」之间切换 */
function toggleNatural(block: HTMLElement): void {
  fitBlock(block, viewportLimit(), !block.classList.contains('is-natural'))
}

/**
 * 扫描 root 下所有 .mermaid-block 并渲染。
 *
 * 每块的源码都留在 <pre class="mermaid-source"> 里不删:
 *   - 渲染失败时可以退回去让用户直接读源码,而不是留一片空白;
 *   - 切换主题时把它重新渲染一遍即可,不需要回到 Markdown 原文再解析一次。
 * 失败要逐块隔离:一张图有问题不能让整篇文档的图都渲染不出来。
 */
export async function hydrateMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (blocks.length === 0) return

  const theme = currentMermaidTheme()
  const maxHeight = viewportLimit()

  for (const block of blocks) {
    // 记下源码,并给每块一个稳定序号,方便排查是哪一张图出的问题
    const source = block.querySelector<HTMLElement>('.mermaid-source')?.textContent?.trim() ?? ''
    if (!source) continue

    try {
      const svg = await renderSvg(source, theme)
      let canvas = block.querySelector<HTMLElement>('.mermaid-canvas')
      if (!canvas) {
        canvas = document.createElement('div')
        canvas.className = 'mermaid-canvas'
        block.appendChild(canvas)
        // 点击切换「适应 / 原始尺寸」,用 title 提示,不额外占版面
        canvas.title = '点击切换:适应宽度 / 原始尺寸'
        canvas.addEventListener('click', () => toggleNatural(block))
      }
      canvas.innerHTML = svg
      block.classList.remove('is-failed')
      block.classList.add('is-rendered')
      fitBlock(block, maxHeight, false)
    } catch (err) {
      // 源码本来就还在,加个类让样式把它显示出来即可
      block.classList.remove('is-rendered')
      block.classList.add('is-failed')
      block.dataset.mermaidError = err instanceof Error ? err.message : String(err)
    }
  }
}

/** 窗口尺寸或栏宽变化后用:只重算缩放,不重新渲染 SVG */
export function refitMermaidBlocks(root: HTMLElement): void {
  const maxHeight = viewportLimit()
  for (const block of root.querySelectorAll<HTMLElement>('.mermaid-block.is-rendered')) {
    fitBlock(block, maxHeight, block.classList.contains('is-natural'))
  }
}
