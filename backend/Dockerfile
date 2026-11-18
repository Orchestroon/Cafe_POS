FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Dev images carry the test and lint tools; the production image does not (DEV_EXTRAS=false).
ARG DEV_EXTRAS=true
# Dependencies first so the layer is cached; pyproject declares no packages.
COPY pyproject.toml .
RUN if [ "$DEV_EXTRAS" = "true" ]; then pip install --no-cache-dir ".[dev]"; \
    else pip install --no-cache-dir .; fi

COPY . .
EXPOSE 8000
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8000"]
