FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data PORT=8954
WORKDIR /app
RUN pip install --no-cache-dir tzdata==2025.2
COPY server.py ./
COPY seed ./seed
COPY static ./static
VOLUME /data
EXPOSE 8954
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8954/api/health',timeout=4)"
CMD ["python", "server.py"]
