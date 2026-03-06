FROM python:3.12-slim

WORKDIR /app

# Install system dependencies required by Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium and its system dependencies via Playwright
RUN playwright install --with-deps chromium

COPY . .

EXPOSE 3000

CMD ["python", "server.py"]
