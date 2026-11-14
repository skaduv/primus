"use client";

// 时间线里用户消息的附件：消息末尾的 `<file>` 引用（Core 原生格式）解析成文件标签，
// 不把路径与内联的文件内容原样铺在气泡里。悬停看完整路径；内联了内容的文本文件注明“已附上内容”。
import type { FileTag, ImageContent } from "@primus/protocol";
import { FileIcon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { strings } from "@/lib/strings";
import { fileIconForName } from "../file-ref";
import { attachmentKind } from "./attachment-kind";

const t = strings.chat.attachments;

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function SentFiles({ files }: { files: FileTag[] }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label={t.sent} className="flex max-w-full flex-wrap justify-end gap-1.5">
      {files.map((f, i) => {
        const name = baseName(f.path);
        const inlined = f.content !== undefined;
        return (
          <Tooltip
            // 同一路径可能出现两次（重发），按位置区分
            // biome-ignore lint/suspicious/noArrayIndexKey: 列表只随消息整体替换，不会重排
            key={`${i}-${f.path}`}
            content={inlined ? `${f.path}\n${t.inlined}` : f.path}
          >
            <li
              aria-label={inlined ? `${name}（${t.inlined}）` : name}
              className="flex h-7 max-w-56 items-center gap-1.5 rounded-[9px] bg-tile px-2 text-xs ring-1 ring-tile-ring"
            >
              <FileIcon name={fileIconForName(name)} size="sm" />
              <span className="min-w-0 truncate">{name}</span>
            </li>
          </Tooltip>
        );
      })}
    </ul>
  );
}

/**
 * 随消息发给模型的图片（Core 存进用户消息的 image 块）。粘贴或拖入的图片没有路径，只有这里能显示；
 * 有路径的图片同时带 `<file>` 标签，由 visibleFileTags 去掉，避免同一张图显示两次
 */
export function SentImages({ images }: { images: readonly ImageContent[] }) {
  if (images.length === 0) return null;
  return (
    <ul aria-label={t.sentImages} className="flex max-w-full flex-wrap justify-end gap-1.5">
      {images.map((img, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 列表只随消息整体替换，不会重排
        <li key={i} className="overflow-hidden rounded-[9px] ring-1 ring-tile-ring">
          {/* biome-ignore lint/performance/noImgElement: 静态导出，图片是消息里的 base64 */}
          <img
            src={`data:${img.mimeType};base64,${img.data}`}
            alt={t.sentImage}
            draggable={false}
            className="block size-16 bg-tile object-cover"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * 气泡上方要显示的文件标签：模型收到了图片时，图片路径的标签由缩略图代替；
 * 图片块少于图片标签（读取失败、模型不看图）时保留全部标签
 */
export function visibleFileTags(files: FileTag[], imageCount: number): FileTag[] {
  if (imageCount === 0) return files;
  const isImage = (f: FileTag) => attachmentKind(f.path) === "image";
  const imageTags = files.filter(isImage).length;
  return imageCount >= imageTags ? files.filter((f) => !isImage(f)) : files;
}
