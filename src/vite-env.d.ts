/// <reference types="vite/client" />

// 引入 vite/client 后,`import 'xxx.css'` 这类副作用导入就有了模块声明,
// 不再需要每个 CSS 导入都挂一行 @ts-expect-error(那种写法一旦类型补齐反而会报"未使用的抑制")。
