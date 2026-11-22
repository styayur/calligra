import argparse

import pytest
from fastapi.testclient import TestClient

from launch_companion import create_companion, exact_origin

ORIGIN = "https://styayur.github.io"
TOKEN = "a8" * 32
AUTH = {"Authorization": "Bearer " + TOKEN}


@pytest.mark.parametrize("value", ["*", "null", "https://example.org/", "https://user@site.test",
                                   "https://site.test?use=1", "http://example.org", "http://localhost:65536"])
def test_configuration_rejects_non_origins(value):
    with pytest.raises(argparse.ArgumentTypeError):
        exact_origin(value)


def test_authentication_origin_and_content_limits():
    app = create_companion(TOKEN, [ORIGIN])
    local = TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 12345))
    status = "/api/workbench/status"
    assert local.get(status).status_code == 403
    assert local.get(status, headers={**AUTH, "Host": "untrusted.example"}).status_code == 403
    assert local.get(status, headers={**AUTH, "Origin": "https://untrusted.example"}).status_code == 403
    good = local.get(status, headers={**AUTH, "Origin": ORIGIN})
    assert good.json() == {"ready": True, "protocol": 1, "fonts": True,
                           "documents": True, "pdf": False, "ocr": False}
    assert good.headers["access-control-allow-origin"] == ORIGIN
    assert good.headers["cache-control"] == "no-store"
    assert local.get("/docs", headers=AUTH).status_code == 404
    remote = TestClient(app, base_url="http://127.0.0.1", client=("10.0.0.8", 12345))
    assert remote.get(status, headers={**AUTH, "X-Forwarded-For": "127.0.0.1"}).status_code == 403
    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type",
                 "Access-Control-Request-Private-Network": "true"}
    good = local.options(status, headers={**preflight, "Origin": ORIGIN})
    assert good.status_code == 200 and good.headers["access-control-allow-private-network"] == "true"
    bad = local.options(status, headers={**preflight, "Origin": "https://untrusted.example"})
    assert bad.status_code == 400 and "access-control-allow-origin" not in bad.headers
    oversized = local.post("/api/workbench/fonts", headers={**AUTH, "Content-Type": "application/json",
                           "Content-Length": "100000000"}, content=b"{}")
    assert oversized.status_code == 413
