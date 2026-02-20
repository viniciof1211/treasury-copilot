"""Modal deployment for Data Service Agent — separate microservice.

Exposes:
  - POST /invoke  — invoke the data service agent with a request
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

data_service_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "langchain>=0.3.0",
        "langchain-openai>=0.3.0",
        "langchain-community>=0.3.0",
        "langgraph>=0.2.0",
        "langsmith>=0.2.0",
        "httpx>=0.27.0",
        "starlette>=0.38.0",
        "uvicorn>=0.30.0",
    )
    .add_local_dir(str(_AGENT_DIR), remote_path="/app/agent")
)

app = modal.App(
    name="treasury-data-service-agent",
    image=data_service_image,
)

treasury_secret = modal.Secret.from_name(
    "treasury-copilot-secrets",
    required_keys=[
        "OPENROUTER_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "LANGCHAIN_API_KEY",
    ],
)


@app.function(
    secrets=[treasury_secret],
    timeout=300,
    memory=2048,
    cpu=1.0,
)
@modal.concurrent(max_inputs=10)
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
    os.environ["LANGCHAIN_PROJECT"] = "treasury-data-service-agent"
    os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"
    os.environ.setdefault("OPENROUTER_MODEL", "gpt-oss-120b")

    from agent.data_service_agent import get_data_service_graph
    from langchain_core.messages import HumanMessage

    async def invoke(request: Request):
        """Invoke the data service agent.
        Accepts: { request: str }
        Returns: { content: str }
        """
        body = await request.json()
        user_request = body.get("request", "")

        graph = get_data_service_graph()
        result = graph.invoke({"messages": [HumanMessage(content=user_request)]})
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

        return JSONResponse({
            "content": content[:8000],
            "success": True,
        })

    async def health(request: Request):
        from agent.llm_fallback import get_fallback_status
        return JSONResponse({
            "status": "ok",
            "agent": "data_service",
            "model": os.environ.get("OPENROUTER_MODEL", "gpt-oss-120b"),
            "langsmith_project": "treasury-data-service-agent",
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
