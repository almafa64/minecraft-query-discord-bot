FROM denoland/deno:latest

WORKDIR /app

COPY deno.json .
COPY deno.lock .
RUN deno install

RUN deno cache src/*.ts && chown deno /app