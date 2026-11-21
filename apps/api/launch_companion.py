"""Minimal loopback service for the installed Windows application."""
import os
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI
import uvicorn
from app.config import Settings
from app.routes.workbench import router


def main():
    token = os.environ.pop("CALLIGRA_MANAGED_TOKEN", "")
    if len(token) != 64:
        raise SystemExit("Companion must be started by Calligra")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = Settings(_env_file=None)
    app.state.workbench_token = token
    app.include_router(router, prefix="/api")

    class Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started:
                print(f"CALLIGRA_READY {sockets[0].getsockname()[1]}", flush=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        Server(uvicorn.Config(app, proxy_headers=False, access_log=False, log_level="warning")).run(
            sockets=[listener]
        )


if __name__ == "__main__":
    main()
