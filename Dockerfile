FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
ENV NODE_ENV=production
CMD ["npm", "start"]
