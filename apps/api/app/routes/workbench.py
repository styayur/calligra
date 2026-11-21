"""Opt-in local endpoints for the desktop font and document workspaces."""

from io import BytesIO
from ipaddress import ip_address
from importlib.util import find_spec
from secrets import compare_digest
import json
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile
from xml.parsers.expat import ExpatError

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from fontTools.ttLib import TTLibError
from pydantic import BaseModel, Field
from PIL import Image

from app.schemas import GlyphRead
from app.services.document_pdf import render_pdf
from app.services.document_typesetting import MAX_ARCHIVE, Selection, convert_with_font
from app.services.extraction_ocr import recognize_glyphs
from app.services.font_studio import MAX_GLYPHS, MAX_REQUEST, SUPPORTED, compile_font

router = APIRouter(prefix="/workbench", tags=["local workbench"])


def require_local(request: Request):
    origin = request.headers.get("origin")
    allowed = request.app.state.settings.cors_origin_list
    try:
        loopback = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        loopback = False
    if not loopback or request.url.hostname not in {"127.0.0.1", "localhost", "::1"} or (
            origin and origin not in allowed):
        raise HTTPException(403, "This endpoint requires an authorized local connection")
    token = getattr(request.app.state, "workbench_token", None)
    if token and not compare_digest(request.headers.get("authorization", "").encode(), ("Bearer " + token).encode()):
        raise HTTPException(403, "Invalid Companion authorization")


@router.get("/status", response_class=JSONResponse)
def status(request: Request):
    require_local(request)
    settings = request.app.state.settings
    return JSONResponse({
        "ready": True,
        "pdf": bool(settings.libreoffice_path and settings.libreoffice_path.is_file()),
        "ocr": bool(settings.ocr_model_dir and settings.ocr_model_dir.is_dir() and find_spec("tesserocr")),
    }, headers={"Cache-Control": "no-store"})


async def read_bounded(request: Request, limit: int, content_type: str):
    require_local(request)
    if request.headers.get("content-type", "").split(";")[0].lower() != content_type:
        raise HTTPException(415, "Unsupported request content type")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise HTTPException(413, "Request exceeds the local processing limit")
        data.extend(chunk)
    return bytes(data)


def zip_output(parts: dict[str, bytes]):
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return Response(output.getvalue(), media_type="application/zip", headers={"Cache-Control": "no-store"})


class ScanRecognitionRequest(BaseModel):
    language: str = Field(max_length=12)
    crops: list[str] = Field(min_length=1, max_length=200)


@router.post("/scan-recognition", response_class=JSONResponse)
async def recognize_scan(request: Request):
    raw = await read_bounded(request, 32 * 1024 * 1024, "application/json")
    model_root = request.app.state.settings.ocr_model_dir
    if model_root is None:
        raise HTTPException(422, "Configure local OCR model data to enable recognition")
    try:
        options = ScanRecognitionRequest.model_validate_json(raw)
        receipt = await run_in_threadpool(recognize_glyphs, options.crops, options.language, model_root)
        return JSONResponse(receipt, headers={"Cache-Control": "no-store"})
    except (ValueError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(422, str(error).splitlines()[0][:500]) from error


class FontRequest(BaseModel):
    glyphs: list[GlyphRead] = Field(min_length=1, max_length=MAX_GLYPHS)
    family: str = Field(max_length=48)
    text: str = Field(default="", max_length=4096)
    formats: set[str] = Field(default_factory=lambda: SUPPORTED.copy())
    confirm_private_rights: bool = False


@router.post("/fonts", response_class=Response)
async def build_font(request: Request):
    raw = await read_bounded(request, MAX_REQUEST, "application/json")
    try:
        options = FontRequest.model_validate_json(raw)
        parts, _ = await run_in_threadpool(
            compile_font, options.glyphs, options.text, options.family, options.formats,
            approved_work=options.confirm_private_rights,
        )
        return zip_output(parts)
    except (ValueError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(422, str(error).splitlines()[0][:500]) from error


@router.post("/documents/{kind}", response_class=Response)
async def typeset_document(
        kind: str, request: Request, font_bytes: int = Query(ge=1, le=MAX_ARCHIVE),
        headings: bool = False, han_only: bool = True, original_font: str | None = Query(None, max_length=120),
        paragraphs: list[int] = Query(default=[], max_length=500), analyze: bool = False, pdf: bool = False):
    data = await read_bounded(request, MAX_ARCHIVE + font_bytes, "application/octet-stream")
    if kind not in {"docx", "odt"} or font_bytes >= len(data) or any(number < 1 for number in paragraphs):
        raise HTTPException(422, "Unsupported document type or invalid selection")
    try:
        options = Selection(headings, frozenset(paragraphs), original_font, han_only)
        output, report = await run_in_threadpool(
            convert_with_font, data[font_bytes:], kind, data[:font_bytes], options,
        )
        if analyze:
            return JSONResponse(report, headers={"Cache-Control": "no-store"})
        receipt = json.dumps(report, ensure_ascii=False, indent=2).encode()
        parts = {f"Calligra.{kind}": output, "analysis.json": receipt}
        if pdf:
            executable = request.app.state.settings.libreoffice_path
            if not executable:
                raise ValueError("Configure the local LibreOffice executable for PDF output")
            parts["Calligra.pdf"] = await run_in_threadpool(render_pdf, output, kind, executable)
        return zip_output(parts)
    except (ValueError, OSError, KeyError, BadZipFile, ExpatError, TTLibError) as error:
        raise HTTPException(422, str(error).splitlines()[0][:500]) from error
