FROM python:3.11-slim

WORKDIR /app

# System deps for lxml, playwright (optional), pdf parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc curl ca-certificates poppler-utils && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir fastapi==0.115.0 uvicorn==0.32.0 httpx==0.27.2

# Skip playwright browsers in default image (heavy). Add `RUN playwright install chromium` if a source needs JS rendering.

COPY . .

# State directory (writable in container)
RUN mkdir -p /app/data/find_jobs_state

EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
