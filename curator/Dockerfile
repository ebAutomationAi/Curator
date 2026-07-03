FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src/ ./src/
RUN mkdir -p /app/logs
EXPOSE 3001
CMD ["node", "src/index.js"]
