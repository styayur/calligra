"""Run Calligra's optional, authenticated loopback Companion."""
import argparse
import os
import socket
import sys
from pathlib import Path
from secrets import token_hex
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from app.config import Settings
from app.routes.workbench import router

OFFICIAL_ORIGIN = "https://styayur.github.io"


def exact_origin(value: str) -> str:
    url = urlsplit(value)
    try:
        valid_port = url.port is None or 0 < url.port < 65536
    except ValueError:
        valid_port = False
    local = url.hostname in {"127.0.0.1", "localhost", "::1"}
    if (not valid_port or not url.hostname or url.username is not None or
            url.path or url.query or url.fragment or
            value != f"{url.scheme}://{url.netloc}" or
            not (url.scheme == "https" or url.scheme == "http" and local)):
        raise argparse.ArgumentTypeError("Enter an exact HTTPS origin or an HTTP loopback origin")
    return value


def create_companion(token: str, origins: list[str], *, managed: bool = False, **paths):
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("Companion requires a 256-bit bearer token")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = Settings(_env_file=None, cors_origins=",".join(origins),
                                  enable_local_workbench=managed, **paths)
    app.state.workbench_token = token
    if not managed:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                           allow_headers=["Authorization", "Content-Type"],
                           allow_private_network=True, max_age=180)
    app.include_router(router, prefix="/api")
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", type=exact_origin, action="append",
                        help="Exact origin authorized to use the token (defaults to official Calligra Pages)")
    parser.add_argument("--libreoffice", type=Path, help="Local LibreOffice executable for PDF")
    parser.add_argument("--ocr-model-dir", type=Path, help="Local optional Tesseract model directory")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    paths = {}
    for name, value in (("libreoffice_path", args.libreoffice), ("ocr_model_dir", args.ocr_model_dir)):
        if value is not None:
            paths[name] = value.expanduser().resolve()
    managed_token = os.environ.pop("CALLIGRA_MANAGED_TOKEN", "")
    token = managed_token or token_hex(32)
    origins = [] if managed_token else args.origin or [OFFICIAL_ORIGIN]
    app = create_companion(token, origins, managed=bool(managed_token), **paths)

    class Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started:
                port = sockets[0].getsockname()[1]
                print(f"CALLIGRA_READY {port}", flush=True)
                if not managed_token:
                    print(f"Calligra connection code: {port}:{token}", flush=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0 if managed_token else args.port))
        Server(uvicorn.Config(app, proxy_headers=False, access_log=False, log_level="warning")).run(
            sockets=[listener]
        )


if __name__ == "__main__":
    main()
