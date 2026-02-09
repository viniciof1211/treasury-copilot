# ────────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the React/Vite application
# ────────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better Docker layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# VITE_ env vars are baked into the JS bundle at build time.
# Pass them as build args so they get embedded in the static output.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_COPILOT_CLOUD_API_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_COPILOT_CLOUD_API_KEY=$VITE_COPILOT_CLOUD_API_KEY

RUN npm run build

# ────────────────────────────────────────────────────────────────────────────────
# Stage 2: Serve with nginx (tiny, production-ready)
# ────────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config (SPA routing, gzip, port 8000)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8000

CMD ["nginx", "-g", "daemon off;"]
