FROM node:18

# Set working directory
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install

# Copy rest of your source code
COPY . .

# Build the Vite app
RUN npm run build

# Expose the port Vite preview will serve on
EXPOSE 8180

# Run Vite preview on port 8180
CMD ["npm", "run", "preview", "--", "--port", "8180", "--host"]