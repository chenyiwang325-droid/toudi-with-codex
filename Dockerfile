FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 TOUDI_MODE=hosted TOUDI_WORKSPACE=/var/lib/toudi
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY run.py ./
COPY app ./app
COPY docs ./docs
COPY AGENTS.md ./
RUN useradd --create-home --uid 10001 toudi && mkdir -p /var/lib/toudi && chown -R toudi:toudi /var/lib/toudi /app
USER toudi
EXPOSE 10000
CMD ["python3", "run.py"]
