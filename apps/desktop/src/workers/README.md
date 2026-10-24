# workers

Web Worker：Shiki 代码高亮、Markdown 增量解析。用 `new Worker(new URL("./shiki.worker.ts", import.meta.url))` 由 Next.js 打包。
