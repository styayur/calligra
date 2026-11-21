"""Opt-in single-glyph OCR. Predictions are tentative annotations."""
import base64
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from PIL import Image
import regex

MODELS = {"chi_sim", "chi_tra", "jpn"}
MIN_CONFIDENCE = 65


def recognize_glyphs(images: list[str], language: str, model_root: Path):
    if language not in MODELS:
        raise ValueError("Unsupported OCR language")
    try:
        from tesserocr import OEM, PSM, PyTessBaseAPI, tesseract_version
    except ImportError as error:
        raise ValueError("Install the optional local OCR dependencies") from error
    model = model_root / f"{language}.traineddata"
    if not model.is_file() or model.stat().st_size > 80 * 1024 * 1024:
        raise ValueError("The selected local OCR model is absent or excessive")
    model_checksum = sha256(model.read_bytes()).hexdigest()
    suggestions = []
    script = r"\p{Script=Han}" if language != "jpn" else r"[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]"
    try:
        with PyTessBaseAPI(path=str(model_root), lang=language, psm=PSM.SINGLE_CHAR, oem=OEM.LSTM_ONLY) as engine:
            for encoded in images:
                if len(encoded) > 600_000:
                    raise ValueError("OCR crop bytes exceed the supported limit")
                payload = base64.b64decode(encoded, validate=True)
                with Image.open(BytesIO(payload), formats=["PNG"]) as source:
                    if max(source.size) > 384:
                        raise ValueError("OCR crops cannot exceed 384 pixels per side")
                    alpha = source.convert("RGBA")
                canvas = Image.new("RGB", alpha.size, "white")
                canvas.paste(alpha, mask=alpha.getchannel("A"))
                engine.SetImage(canvas)
                engine.SetSourceResolution(300)
                text = engine.GetUTF8Text().strip()
                score = engine.MeanTextConf()
                accepted = score >= MIN_CONFIDENCE and regex.fullmatch(script, text)
                suggestions.append({"suggestion": text if accepted else None, "confidence": score})
    except RuntimeError as error:
        raise ValueError("Could not initialize the selected local OCR model") from error
    return {
        "engine": tesseract_version().splitlines()[0],
        "language": language,
        "model_sha256": model_checksum,
        "suggestions": suggestions,
    }
