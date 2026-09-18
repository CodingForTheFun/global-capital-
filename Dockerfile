FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2
WORKDIR /app
COPY ops/propline-training/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY ops/propline-training/ ./
RUN python -m unittest -v
USER 10001:10001
CMD ["python", "-u", "run.py"]
