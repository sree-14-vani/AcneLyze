from pathlib import Path
import sys

from starlette.types import ASGIApp, Receive, Scope, Send

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.main import app as fastapi_app

class PrefixedFastAPI:
    def __init__(self, app: ASGIApp, prefix: str) -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            scope = dict(scope)
            path = scope.get("path", "")
            scope["path"] = self.prefix + path
            scope["raw_path"] = scope["path"].encode("utf-8")
        await self.app(scope, receive, send)
