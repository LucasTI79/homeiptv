# Stage 1: Build the Application
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js and build essentials
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    gnupg \
    python3-setuptools && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package configurations
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
COPY shared/types/package*.json ./shared/types/

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy source code
COPY frontend ./frontend
COPY backend ./backend
COPY shared/types ./shared/types

# Build Frontend and Backend
RUN npm run build -w @homeiptv/frontend
RUN npm run build -w @homeiptv/backend

# Prune devDependencies to shrink node_modules
RUN npm prune --omit=dev

# ---

# Stage 2: The Final Image
FROM ubuntu:24.04

ARG TARGETARCH

# Set environment variables for NVIDIA capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV DEBIAN_FRONTEND=noninteractive
ENV LD_LIBRARY_PATH=/usr/lib/jellyfin-ffmpeg/lib

# Install Node.js (v20), FFmpeg, and VA-API drivers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    mesa-va-drivers && \
    curl -s https://repo.jellyfin.org/ubuntu/jellyfin_team.gpg.key | gpg --dearmor | tee /usr/share/keyrings/jellyfin.gpg >/dev/null && \
    echo "deb [arch=${TARGETARCH} signed-by=/usr/share/keyrings/jellyfin.gpg] https://repo.jellyfin.org/ubuntu noble main" > /etc/apt/sources.list.d/jellyfin.list && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends \
    jellyfin-ffmpeg7 \
    nodejs && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/bin/ffmpeg && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/bin/ffprobe && \
    ln -s /usr/lib/jellyfin-ffmpeg/vainfo /usr/bin/vainfo && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy configuration and production dependencies
COPY package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/backend/node_modules ./backend/node_modules

# Copy workspace package.json files
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
COPY shared/types/package*.json ./shared/types/

# Copy built assets
COPY --from=builder /usr/src/app/frontend/dist ./frontend/dist
COPY --from=builder /usr/src/app/backend/dist ./backend/dist
COPY --from=builder /usr/src/app/shared/types ./shared/types

EXPOSE 8998

# Create volumes for persistent data
RUN mkdir -p /data /dvr
VOLUME /data
VOLUME /dvr
ENV DATA_DIR=/data
ENV DVR_DIR=/dvr

# Run the backend service (which also serves the frontend)
CMD [ "node", "backend/dist/src/index.js" ]
