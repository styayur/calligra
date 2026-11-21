"""Measure OCR coverage and corrections on synthetic controls and the bundled CODH sample."""
import argparse
from base64 import b64encode
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from app.services.extraction_ocr import recognize_glyphs


def encode(image):
    image = image.convert("RGBA")
    bounds = image.getbbox()
    if bounds:
        image = image.crop(bounds)
    image.thumbnail((344, 344))
    padded = Image.new("RGB", (image.width + 40, image.height + 40), "white")
    padded.paste(image, (20, 20), image.getchannel("A"))
    output = BytesIO()
    padded.save(output, format="PNG")
    return b64encode(output.getvalue()).decode()


def metrics(expected, receipt):
    predicted = receipt["suggestions"]
    recognized = sum(row["suggestion"] is not None for row in predicted)
    correct = sum(row["suggestion"] == character for row, character in zip(predicted, expected, strict=True))
    return {
        "engine": receipt["engine"], "language": receipt["language"], "model_sha256": receipt["model_sha256"],
        "items": len(expected), "suggestions": recognized, "correct": correct,
        "manual_review_or_correction": len(expected) - correct,
        "per_glyph": [{"expected": character, **row} for character, row in zip(expected, predicted, strict=True)],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tessdata", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    controls = list("山水日月天地永春")
    font = ImageFont.truetype(args.font, 150)
    crops = []
    for character in controls:
        image = Image.new("RGBA", (224, 224))
        ImageDraw.Draw(image).text((112, 112), character, fill="black", font=font, anchor="mm")
        crops.append(encode(image))
    modern = metrics(controls, recognize_glyphs(crops, "chi_tra", args.tessdata))

    public = ROOT / "apps/web/public"
    rows = json.loads((public / "japanese/glyphs.json").read_text(encoding="utf-8"))
    crops = []
    for row in rows:
        with Image.open(public / row["asset"]["url"]) as source:
            glyph = source.convert("RGBA")
        ratio = min(4, 344 / max(glyph.size))
        crops.append(encode(glyph.resize(tuple(round(length * ratio) for length in glyph.size))))
    historical = metrics([row["character"] for row in rows], recognize_glyphs(crops, "jpn", args.tessdata))
    historical["source"] = "CODH Kuzushiji / NIJL, DOI 10.20676/00000340, CC BY-SA 4.0"
    receipt = {"synthetic_chinese": modern, "historical_codh": historical}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    for key, values in receipt.items():
        print(f"{key}: {values['correct']}/{values['items']} correct, {values['suggestions']} suggestions")
    if not modern["correct"]:
        raise SystemExit("OCR yielded no correct labels on the synthetic controls")


if __name__ == "__main__":
    main()
