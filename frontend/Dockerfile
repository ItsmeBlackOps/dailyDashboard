FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --fund=false

COPY . .
RUN npm run build

EXPOSE 8180

CMD ["npm", "run", "start"]
