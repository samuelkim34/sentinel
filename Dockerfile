FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=43117
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 43117
CMD ["npm", "run", "start"]
