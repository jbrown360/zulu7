# Build Stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production Stage
FROM node:20-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server
COPY --from=build /app/dist ./dist
COPY server.js ./

# Create directory for published configs validation
RUN mkdir -p published_configs

EXPOSE 8080

CMD ["npm", "start"]
