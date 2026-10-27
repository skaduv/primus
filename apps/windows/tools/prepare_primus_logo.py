from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Design" / "PrimusLogoSource.png"
ASSETS = ROOT / "Assets"


def smoothstep(values: np.ndarray) -> np.ndarray:
    values = np.clip(values, 0.0, 1.0)
    return values * values * (3.0 - 2.0 * values)


def extract_mark() -> Image.Image:
    source = Image.open(SOURCE).convert("RGB")
    mark = source.crop((315, 90, 945, 790))
    rgb = np.asarray(mark, dtype=np.float32)

    maximum = rgb.max(axis=2) / 255.0
    minimum = rgb.min(axis=2) / 255.0
    saturation = (maximum - minimum) / np.maximum(maximum, 1e-6)

    # The white-keyed artwork has saturated color everywhere except for small
    # enclosed white highlights. The saturation gate drops the neutral shadow.
    alpha = ((saturation > 0.22) | (maximum < 0.55)).astype(np.float32)
    alpha_labels, _ = ndimage.label(alpha)
    component_sizes = np.bincount(alpha_labels.ravel())
    keep = component_sizes >= 150
    keep[0] = False
    alpha = keep[alpha_labels].astype(np.float32)

    # Restore enclosed specular highlights without filling large cutouts.
    holes, hole_count = ndimage.label(alpha == 0)
    hole_sizes = np.bincount(holes.ravel())
    border_holes = np.unique(
        np.concatenate((holes[0], holes[-1], holes[:, 0], holes[:, -1]))
    )
    for hole_label in range(1, hole_count + 1):
        if hole_label not in border_holes and hole_sizes[hole_label] < 3000:
            alpha[holes == hole_label] = 1.0

    # Feather only the silhouette edge, then compensate for the original
    # white compositing so the mark has no light halo on dark backgrounds.
    alpha = ndimage.gaussian_filter(alpha, sigma=0.65)
    alpha = smoothstep(alpha)

    alpha_3d = alpha[..., np.newaxis]
    foreground = np.where(
        alpha_3d > 0.02,
        (rgb - 254.0 * (1.0 - alpha_3d)) / np.maximum(alpha_3d, 1e-6),
        0.0,
    )
    rgba = np.dstack(
        (
            np.clip(foreground, 0.0, 255.0),
            alpha * 255.0,
        )
    ).astype(np.uint8)

    extracted = Image.fromarray(rgba, "RGBA")
    bounds = extracted.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bounds is None:
        raise RuntimeError("No logo foreground was detected.")
    return extracted.crop(bounds)


def fit_square(mark: Image.Image, size: int, fill: float) -> Image.Image:
    canvas_size = round(size * fill)
    scale = min(canvas_size / mark.width, canvas_size / mark.height)
    resized = mark.resize(
        (round(mark.width * scale), round(mark.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
    )
    return canvas


def fit_wide(mark: Image.Image, width: int, height: int, fill: float) -> Image.Image:
    target_height = round(height * fill)
    target_width = round(height * fill)
    scale = min(target_width / mark.width, target_height / mark.height)
    resized = mark.resize(
        (round(mark.width * scale), round(mark.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((width - resized.width) // 2, (height - resized.height) // 2),
    )
    return canvas


def main() -> None:
    mark = extract_mark()
    ASSETS.mkdir(parents=True, exist_ok=True)

    primus_logo = fit_square(mark, 1024, 0.82)
    primus_logo.save(ASSETS / "PrimusLogo.png", format="PNG", optimize=True)

    # A tight 48 px asset remains crisp when Windows renders the title-bar
    # icon at 24 px (150% scaling) or downsamples it to 16/32 px.
    titlebar_icon = fit_square(mark, 192, 0.98).resize(
        (48, 48),
        Image.Resampling.LANCZOS,
    )
    titlebar_icon = titlebar_icon.filter(
        ImageFilter.UnsharpMask(radius=0.8, percent=130, threshold=1)
    )
    titlebar_icon.save(ASSETS / "PrimusTitleBarIcon.png", format="PNG", optimize=True)

    fit_square(mark, 300, 0.78).save(ASSETS / "Square150x150Logo.scale-200.png")
    fit_square(mark, 88, 0.84).save(ASSETS / "Square44x44Logo.scale-200.png")
    fit_square(mark, 24, 0.92).save(
        ASSETS / "Square44x44Logo.targetsize-24_altform-unplated.png"
    )
    fit_square(mark, 48, 0.88).save(
        ASSETS / "Square44x44Logo.targetsize-48_altform-lightunplated.png"
    )
    fit_square(mark, 50, 0.86).save(ASSETS / "StoreLogo.png")
    fit_square(mark, 48, 0.86).save(ASSETS / "LockScreenLogo.scale-200.png")
    fit_wide(mark, 620, 300, 0.72).save(
        ASSETS / "Wide310x150Logo.scale-200.png"
    )
    fit_wide(mark, 1240, 600, 0.66).save(
        ASSETS / "SplashScreen.scale-200.png"
    )

    primus_logo.save(
        ASSETS / "AppIcon.ico",
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48),
               (64, 64), (128, 128), (256, 256)],
    )

    print(f"Primus logo assets written to {ASSETS}")


if __name__ == "__main__":
    main()
