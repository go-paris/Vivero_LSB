FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
RUN chmod +x /app/docker-entrypoint.sh
ENV NODE_ENV=production
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "start"]
