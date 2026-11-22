"""Generate the Unicode 18 Vertical_Orientation lookup from official UCD data."""
from hashlib import sha256
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UCD = ROOT / "third_party/unicode/18.0.0"
OUTPUT = ROOT / "apps/web/src/lib/verticalOrientation.json"


def render():
    source = UCD / "VerticalOrientation.txt"
    data = source.read_text(encoding="utf-8")
    assert "# VerticalOrientation-18.0.0.txt" in data and "# @missing: 0000..10FFFF; R" in data
    ranges = []
    for line in data.splitlines():
        fields = line.partition("#")[0].strip()
        if not fields:
            continue
        interval, orientation = (item.strip() for item in fields.split(";"))
        limits = [int(value, 16) for value in interval.split("..")]
        start, end = limits[0], limits[-1]
        assert orientation in {"U", "R", "Tu", "Tr"} and start <= end
        if orientation == "R":
            continue
        if ranges and ranges[-1][1] + 1 == start and ranges[-1][2] == orientation:
            ranges[-1][1] = end
        else:
            ranges.append([start, end, orientation])
    assert all(left[1] < right[0] for left, right in zip(ranges, ranges[1:]))
    return json.dumps({
        "unicode_version": "18.0.0",
        "source_uri": "https://www.unicode.org/Public/18.0.0/ucd/VerticalOrientation.txt",
        "source_sha256": sha256(data.encode()).hexdigest(),
        "ranges": ranges,
    }, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    expected = render()
    if parser.parse_args().check:
        assert OUTPUT.read_text(encoding="utf-8") == expected, "Stale Unicode vertical orientation data"
    else:
        OUTPUT.write_text(expected, encoding="utf-8", newline="\n")
