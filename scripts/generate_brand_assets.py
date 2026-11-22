"""Render the canonical flat Calligra mark into its packaged platform assets."""
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "apps/web/public/icons"
PAPER = "#f4efe5"
SVG = ElementTree.parse(ICONS / "calligra.svg")
GROUP = SVG.getroot().find("{*}g")
INK = GROUP.attrib["fill"]
SHAPES = [tuple(tuple(map(int, point.split(","))) for point in shape.attrib["points"].split())
          for shape in GROUP.findall("{*}polygon")]


def logo(size, foreground=False):
    supersampled = size * 4
    image = Image.new("RGBA", (supersampled, supersampled), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if not foreground:
        draw.rounded_rectangle((0, 0, supersampled - 1, supersampled - 1),
                               radius=round(supersampled * .17), fill=PAPER)
    scale = supersampled / 96 * (.66 if foreground else .83)
    offset = (supersampled - 96 * scale) / 2
    for points in SHAPES:
        draw.polygon([(offset + x * scale, offset + y * scale) for x, y in points], fill=INK)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    for size in (192, 512):
        logo(size).save(ICONS / f"calligra-{size}.png", optimize=True)
    resources = ROOT / "apps/web/android/app/src/main/res"
    for path in resources.glob("mipmap-*/ic_launcher*.png"):
        with Image.open(path) as previous:
            size = previous.width
        logo(size, foreground=path.stem.endswith("_foreground")).save(path, optimize=True)
    for path in resources.glob("drawable*/splash.png"):
        with Image.open(path) as previous:
            width, height = previous.size
        bitmap = Image.new("RGBA", (width, height), PAPER)
        mark = logo(round(min(width, height) * .22))
        bitmap.alpha_composite(mark, ((width - mark.width) // 2, (height - mark.height) // 2))
        bitmap.save(path, optimize=True)


if __name__ == "__main__":
    main()
