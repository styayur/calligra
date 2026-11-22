"""Script-aware identities and rights; absent evidence stays unknown."""
from __future__ import annotations

from typing import Literal
import hashlib
import json
import regex
from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = 2
VariantType = Literal["modern", "traditional", "simplified", "shinjitai", "kyujitai",
                      "hentaigana", "historical", "regional", "font-alternate"]


def codepoints(text: str) -> list[str]:
    return [f"U+{ord(char):04X}" for char in text]


def is_variation_selector(codepoint: int) -> bool:
    return 0xFE00 <= codepoint <= 0xFE0F or 0xE0100 <= codepoint <= 0xE01EF


def variation_pairs(text: str) -> list[tuple[int, int]] | None:
    pairs = []
    previous = ""
    for character in text:
        selector = ord(character)
        if is_variation_selector(selector):
            if (not previous or regex.fullmatch(r"[\p{M}\p{C}\s]", previous) or
                    selector >= 0xE0100 and not regex.fullmatch(r"\p{Ideographic}", previous)):
                return None
            pairs.append((ord(previous), selector))
        previous = character
    return pairs


def unicode_script(text: str) -> str | None:
    # Unicode script classification is not evidence of language or tradition.
    for script in ('Hiragana', 'Katakana', 'Han', 'Hangul', 'Latin'):
        if regex.fullmatch(rf'\p{{Script={script}}}[\p{{Script={script}}}\p{{M}}]*',text):
            return script
    return None


class CharacterIdentity(BaseModel):
    text: str = Field(min_length=1, max_length=32)
    codepoints: list[str] = Field(default_factory=list)
    script: str | None = None
    language: str | None = None
    locale: str | None = None
    canonical: str | None = None

    @model_validator(mode="after")
    def validate_sequence(self):
        actual = codepoints(self.text)
        if self.codepoints and self.codepoints != actual:
            raise ValueError("Identity codepoints do not match its text")
        self.codepoints = actual
        return self


class GlyphVariant(BaseModel):
    type: VariantType | None = None
    id: str | None = Field(default=None, max_length=256)
    glyph_name: str | None = Field(default=None, max_length=256)
    font_glyph_id: int | None = Field(default=None, ge=0)


class ScriptMetadata(BaseModel):
    language: str | None = None
    locale: str | None = None
    script: str | None = None
    writing_tradition: str | None = None
    orthography: str | None = None
    period: str | None = None
    region: str | None = None
    source_collection: str | None = None


class RightsRecord(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)
    commercial_use: bool | None = None
    derivatives_allowed: bool | None = None
    redistribution_allowed: bool | None = None
    research_use: bool | None = None
    attribution_required: bool | None = None
    font_license: bool | None = None
    share_alike_required: bool | None = None


def require_rights(rights: dict, *, bundle: bool = False, commercial: bool = False,
                   derivative: bool = False) -> None:
    record = RightsRecord.model_validate(rights)
    for required, name in ((bundle, "redistribution_allowed"), (commercial, "commercial_use"),
                           (derivative, "derivatives_allowed")):
        if required and getattr(record, name) is not True:
            raise ValueError(f"Rights policy requires explicit {name}=true")


def glyph_identity_key(identity: dict, culture: dict, variant: dict) -> str:
    signature = [identity.get(k) or culture.get(k) for k in ["text", "locale", "language", "script"]]
    signature += [culture.get("writing_tradition")]
    signature += [variant.get(k) for k in ["id", "type", "font_glyph_id"]]
    return hashlib.sha256(json.dumps(signature, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
