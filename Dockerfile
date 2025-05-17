FROM node:22.15-alpine

ENV APP_DIR=/app

RUN set -ex \
  && apk add --no-cache \
  make

WORKDIR ${APP_DIR}

COPY .tool-versions package.json package-lock.json Makefile /app/

RUN make install

COPY . /app

RUN make

ENV PATH=$PATH:node_modules/.bin/
