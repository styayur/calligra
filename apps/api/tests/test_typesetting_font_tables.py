import json
from pathlib import Path

import pytest
from fontTools.ttLib import TTFont

from app.services.font_shaper import FontShaper

ROOT = Path(__file__).resolve().parents[3]


def bundled_font(pack, name):
    directory = ROOT / "samples/fonts" / pack
    entries = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["fonts"]
    return directory / next(item for item in entries if item["id"] == name)["path"]


def test_korean_ivs_uses_the_cmap14_id():
    source = bundled_font("korean", "kr-coverage-serif")
    with TTFont(source) as reference:
        uvs = next(table for table in reference["cmap"].tables if table.format == 14).uvsDict
        name = dict(uvs[0xE0102])[0x5795]
        expected = reference.getGlyphID(name)
        assert expected != reference.getGlyphID(reference.getBestCmap()[0x5795])
    shaper = FontShaper(source)
    assert shaper.shape("垕\U000E0102", locale="ko-KR")[1]["font_glyph_ids"] == [expected]
    assert shaper.shape("垕\U000E01EF", locale="ko-KR") is None
    assert shaper.shape("\U000E0102", locale="ko-KR") is None


@pytest.mark.parametrize("name,expected", [("yuji-boku", 460), ("yuji-mai", 460), ("klee-one", 112)])
def test_font_ligature_shapes_a_run(name, expected):
    shaper = FontShaper(bundled_font("japanese", name))
    shaped = shaper.shape("fi", locale="en", script="Latin")
    assert shaped[1]["font_glyph_ids"] == [expected]
    assert len(shaper.shape("fi", locale="en", script="Latin", features={"liga": 0})[1]["font_glyph_ids"]) == 2
    assert len(shaper.shape("かな", locale="ja-JP", script="Hiragana")[1]["font_glyph_ids"]) == 2
