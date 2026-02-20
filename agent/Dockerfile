# ---- Stage 1: Build Vite frontend ----
FROM node:20-slim AS frontend-build

WORKDIR /frontend

COPY package.json package-lock.json* ./
RUN npm ci

COPY index.html vite.config.ts tsconfig*.json postcss.config.js tailwind.config.js ./
COPY src/ ./src/

# Frontend env vars baked in at build time (Vite inlines import.meta.env.VITE_*)
# VITE_AGENT_URL="" means relative URLs (same origin) — Azure Container App serves both
ENV VITE_AGENT_URL=""
ENV VITE_SUPABASE_URL="https://aanhzgezgyawitpvwrcw.supabase.co"
ENV VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmh6Z2V6Z3lhd2l0cHZ3cmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzU4MDksImV4cCI6MjA4NjAxMTgwOX0.5OLuTL1u9KW6kslGOLoKGNhDyEs09-F9ojzGTLyKjPU"
# Force rebuild with timestamp
ARG BUILD_DATE=2026-02-17-v3
RUN echo "Build date: $BUILD_DATE" && npm run build

# ---- Stage 2: Python backend ----
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python deps
COPY agent/requirements.txt /app/agent/requirements.txt
RUN pip install --no-cache-dir -r /app/agent/requirements.txt

# Pre-download the sentence-transformers model
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy agent code and docs
COPY agent/ /app/agent/
COPY doc/ /app/doc/

# Copy built frontend from Stage 1
COPY --from=frontend-build /frontend/dist /app/static

# Set environment
ENV PYTHONUNBUFFERED=1
ENV FAISS_INDEX_DIR=/tmp/treasury_faiss_index
ENV STATIC_DIR=/app/static

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "agent.server:app", "--host", "0.0.0.0", "--port", "8000"]
