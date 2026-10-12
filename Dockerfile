FROM node:22-slim

# ffmpeg: @discordjs/voice needs it to transcode the Google TTS MP3s to Opus
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 36363

CMD ["node", "src/index.js"]
