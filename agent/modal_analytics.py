"""Modal deployment for Analytics Agent — separate microservice.

Exposes:
  - POST /invoke  — invoke the analytics agent with a request + data
  - GET  /health  — health check
"""

import os
import json
import logging
import modal

logger = logging.getLogger(__name__)

from pathlib import Path

_AGENT_DIR = Path(__file__).parent
_PROJECT_ROOT = _AGENT_DIR.parent

analytics_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "langchain>=0.3.0",
        "langchain-openai>=0.3.0",
        "langchain-community>=0.3.0",
        "langgraph>=0.2.0",
        "langsmith>=0.2.0",
        "pandas>=2.0.0",
        "matplotlib>=3.8.0",
        "seaborn>=0.13.0",
        "numpy>=1.26.0",
        "openpyxl>=3.1.0",
        "starlette>=0.38.0",
        "uvicorn>=0.30.0",
        "httpx>=0.27.0",
    )
    .add_local_dir(str(_AGENT_DIR), remote_path="/app/agent")
)

app = modal.App(
    name="treasury-analytics-agent",
    image=analytics_image,
)

treasury_secret = modal.Secret.from_name(
    "treasury-copilot-secrets",
    required_keys=[
        "OPENROUTER_API_KEY",
        "LANGCHAIN_API_KEY",
    ],
)


@app.function(
    secrets=[treasury_secret],
    timeout=300,
    memory=4096,
    cpu=2.0,
)
@modal.concurrent(max_inputs=5)
@modal.asgi_app()
def web():
    import sys
    sys.path.insert(0, "/app")

    from starlette.applications import Starlette
    from starlette.routing import Route
    from starlette.requests import Request
    from starlette.responses import JSONResponse
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware

    # LangSmith tracing — differentiated project
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = "treasury-analytics-agent"
    os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"
    os.environ.setdefault("ANALYTICS_MODEL", "openai/gpt-4o-mini")

    from agent.analytics_agent import get_analytics_graph
    from langchain_core.messages import HumanMessage

    async def invoke(request: Request):
        """Invoke the analytics agent.
        Accepts: { request: str, data_json?: str }
        Returns: { content: str, images: [...] }
        """
        body = await request.json()
        user_request = body.get("request", "")
        data_json = body.get("data_json", "{}")

        full_request = user_request
        if data_json and data_json != "{}":
            full_request += f"\n\nDatos disponibles (JSON):\n```json\n{data_json[:10000]}\n```"

        graph = get_analytics_graph()
        result = graph.invoke({"messages": [HumanMessage(content=full_request)]})
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

        # Extract images from tool results in the message history
        images = []
        for msg in result["messages"]:
            msg_content = msg.content if hasattr(msg, "content") else str(msg)
            try:
                parsed = json.loads(msg_content)
                if isinstance(parsed, dict) and "images" in parsed:
                    for img in parsed["images"]:
                        if isinstance(img, str) and len(img) > 100:
                            images.append(img)
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        return JSONResponse({
            "content": content[:15000],
            "images": images,
            "success": True,
        })

    async def health(request: Request):
        from agent.llm_fallback import get_fallback_status
        return JSONResponse({
            "status": "ok",
            "agent": "analytics",
            "model": os.environ.get("ANALYTICS_MODEL", "openai/gpt-4o-mini"),
            "langsmith_project": "treasury-analytics-agent",
            "llm_fallback": get_fallback_status(),
        })

    routes = [
        Route("/invoke", invoke, methods=["POST"]),
        Route("/health", health, methods=["GET"]),
    ]

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ]

    return Starlette(routes=routes, middleware=middleware)
