#!/usr/bin/env python3
"""由 assets/logo.png 生成桌面应用的全部图标。

所有尺寸都使用源图的透明外轮廓与线稿：先按内容边界裁掉透明留白，再等比缩放到
画布的 96%；标志内部的面填白，保证黑色线稿在深色任务栏和开始菜单上也清楚。
不重绘小尺寸版本，exe、桌面 / 开始菜单快捷方式和托盘显示同一标志。

输出：src-tauri/icons 下的 icon.ico（编进 Primus.exe：窗口 / 任务栏 / 桌面快捷方式 / 开始菜单 / 安装程序）、
各尺寸 PNG、icon.icns、app-icon.png，以及 src/app/icon.png（浏览器预览的标签页图标）。
用法（仓库根目录）：python3 scripts/render-app-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "apps/desktop/src-tauri/icons"
SOURCE = ROOT / "assets/logo.png"
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
CONTENT_SCALE = 0.96


def load_mark(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    """裁掉源图的透明留白，并生成需要填白面的内部蒙版。"""
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"图标源文件没有可见内容：{SOURCE}")

    left, top, right, bottom = bbox
    side = min(max(right - left, bottom - top), source.width, source.height)
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    crop_left = max(0, min(center_x - side // 2, source.width - side))
    crop_top = max(0, min(center_y - side // 2, source.height - side))
    mark = source.crop((crop_left, crop_top, crop_left + side, crop_top + side))

    # 从外侧泛洪填充透明区域；未被填到的封闭区域就是立方体各面，填白后
    # 黑色线稿无论落在浅色还是深色背景上都有足够对比度。
    alpha = mark.getchannel("A").point(lambda value: 255 if value > 100 else 0)
    padded = Image.new("L", (mark.width + 2, mark.height + 2), 0)
    padded.paste(alpha, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    faces = padded.crop((1, 1, mark.width + 1, mark.height + 1))
    faces = faces.point(lambda value: 0 if value == 128 else 255)
    return mark, faces


def render(mark: Image.Image, faces: Image.Image, size: int) -> Image.Image:
    """把标志缩放到画布 96%；内部面填白，外轮廓之外保持透明。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    content_size = max(1, round(size * CONTENT_SCALE))
    content = mark.resize((content_size, content_size), Image.Resampling.LANCZOS)
    white_faces = Image.new("RGBA", (content_size, content_size), (255, 255, 255, 255))
    white_faces.putalpha(faces.resize((content_size, content_size), Image.Resampling.LANCZOS))
    offset = (size - content_size) // 2
    canvas.alpha_composite(white_faces, (offset, offset))
    canvas.alpha_composite(content, (offset, offset))
    return canvas


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    if source.width != source.height:
        raise ValueError(f"图标源文件必须是正方形：{SOURCE} ({source.width}×{source.height})")
    mark, faces = load_mark(source)
    cache: dict[int, Image.Image] = {}

    def icon(n: int) -> Image.Image:
        if n not in cache:
            cache[n] = render(mark, faces, n)
        return cache[n]

    pngs = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "app-icon.png": 1024,
        "StoreLogo.png": 50,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }
    for name, n in pngs.items():
        icon(n).save(ICONS / name, optimize=True)
    icon(256).save(ROOT / "apps/desktop/src/app/icon.png", optimize=True)

    # ICO 的每个尺寸都单独绘制（不让 Windows 从 256 px 缩小），小尺寸才清楚
    largest = icon(ICO_SIZES[-1])
    largest.save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=[(n, n) for n in ICO_SIZES],
        append_images=[icon(n) for n in ICO_SIZES[:-1]],
    )
    icon(1024).save(ICONS / "icon.icns", format="ICNS")


if __name__ == "__main__":
    main()
