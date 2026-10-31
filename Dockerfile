# OVERDRIVE online server: accounts, profiles, lobbies, chat and race relay for PC (.exe) and browser players.
# Works on any host that runs a Dockerfile (Render, Railway, Fly.io...). Python standard library only.
# Give it a persistent disk at /data so accounts survive restarts. The host sets $PORT.
FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV OVERDRIVE_DATA=/data PYTHONUNBUFFERED=1
RUN mkdir -p /data
CMD ["python3", "server/server.py"]
