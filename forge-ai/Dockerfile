FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 8002
CMD ["node", "server.js"]
