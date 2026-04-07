# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Build backend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for PostgreSQL and compilation
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend static files
COPY --from=frontend-builder /app/dist /app/static

EXPOSE 3344

# Run the FastAPI application
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "3344"]
