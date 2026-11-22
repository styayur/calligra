"""Compare optional NDL line output against the partial historical fixture labels."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


FIXTURES = Path(__file__).resolve().parents[1] / "tests/fixtures/historical-page"


def evaluate(manifest, output_dir):
    image = FIXTURES / manifest["image"]
    assert sha256(image.read_bytes()).hexdigest() == manifest["sha256"]
    result = json.loads((output_dir / (image.stem + ".json")).read_text(encoding="utf-8"))
    lines = [line for page in result["contents"] for line in page if line.get("isTextline") == "true"]
    w, h = manifest["fixture_dimensions"]
    original_w, original_h = manifest["source_dimensions"]
    labels = []
    for item in manifest["labels"]:
        x, y, width, height = item["source_bbox"]
        center_x = (x + width / 2) * w / original_w
        center_y = (y + height / 2) * h / original_h
        covering = []
        for line in lines:
            xs, ys = zip(*line["boundingBox"], strict=True)
            if min(xs) <= center_x <= max(xs) and min(ys) <= center_y <= max(ys):
                covering.append(line)
        labels.append({
            "character": item["text"],
            "covering_lines": len(covering),
            "character_in_covering_line": any(item["text"] in line["text"] for line in covering),
        })
    return {"fixture": image.name, "predicted_lines": len(lines), "partial_labels": labels,
            "centers_covered": sum(bool(item["covering_lines"]) for item in labels),
            "character_in_covering_line": sum(item["character_in_covering_line"] for item in labels)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ndl-results", type=Path, required=True)
    args = parser.parse_args()
    rows = [
        evaluate(json.loads((FIXTURES / name).read_text(encoding="utf-8")), args.ndl_results)
        for name in ("manifest.json", "wang-epitaph-manifest.json", "diguchi-holdout-manifest.json")
    ]
    print(json.dumps(rows, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
