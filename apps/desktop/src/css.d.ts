// 全局样式的副作用导入（next-env.d.ts 由 next build 生成且不入库，干净检出时 typecheck 先于 build 运行）
declare module "*.css";

// 静态图片导入（同 next/image-types：构建后为 StaticImageData；干净检出时 next-env.d.ts 不在）
declare module "*.png" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}
