FROM ghcr.io/puppeteer/puppeteer:latest
# Пропускаем скачивание Chromium при npm install, так как он уже есть в образе
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
CMD [ "npm", "start" ]