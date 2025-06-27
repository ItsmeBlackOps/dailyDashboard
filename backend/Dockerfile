# Use Node.js base image
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your app
COPY . .

# Install tunnelto globally
RUN npm install -g tunnelto

# Expose the port your backend listens on
EXPOSE 3004  # Change this if your backend uses a different port

# Environment variable for subdomain (you can override when running)
ENV SUBDOMAIN=dailydb
ENV PORT=3004

# Start both the backend and tunnelto
CMD ["/bin/bash", "-c", "node index.js & tunnelto --subdomain $SUBDOMAIN --port $PORT"]
