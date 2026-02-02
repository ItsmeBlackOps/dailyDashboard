FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --fund=false

COPY . .

EXPOSE 3004

CMD ["node", "src/index.js"]
