FROM node:22-slim

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json .
RUN npm ci

COPY frontend/ .

# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at runtime -- must be build ARGs, not just environment: in compose.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NODE_ENV=production

RUN npm run build

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD npm run start -- --port ${PORT:-3000}
