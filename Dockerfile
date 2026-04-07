# Production image for the DSTB server (Render Web Service or any Docker host).
FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chown -R node:node /app

USER node

CMD ["npm", "start"]
