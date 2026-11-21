"""Independent geometric test rasters in an NCCU-compatible directory layout."""
from PIL import Image, ImageDraw


def make_cursive_fixture(root):
    for character in "春山":
        for index, directory in enumerate((character, character + "2")):
            target = root / "Test" / directory
            target.mkdir(parents=True)
            image = Image.new("L", (96, 96), 0)
            drawing = ImageDraw.Draw(image)
            drawing.line([(16, 28 + index * 3), (74, 28), (32, 77), (66, 62)], fill=255, width=6)
            if character == "春":
                drawing.rectangle((35, 37, 56, 65), outline=255, width=3)
            image.save(target / f"fixture-{index}.png")
    return root
