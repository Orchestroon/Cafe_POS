FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Dependencies first so the layer is cached; pyproject declares no packages.
COPY pyproject.toml .
RUN pip install --no-cache-dir ".[dev]"

COPY . .
EXPOSE 8000
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8000"]
