FROM python:3.12-slim
WORKDIR /service
COPY requirements.txt requirements-worker.txt ./
ARG WITH_TRANSCRIPTION=false
RUN pip install --no-cache-dir -r requirements.txt && if [ "$WITH_TRANSCRIPTION" = "true" ]; then pip install --no-cache-dir -r requirements-worker.txt; fi
COPY app ./app
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
