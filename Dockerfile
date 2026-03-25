# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and registry config
COPY package.json package-lock.json .npmrc ./

# Auth token passed as build arg
ARG NPM_TOKEN
RUN echo "//git.coldforge.xyz/api/v4/projects/44/packages/npm/:_authToken=${NPM_TOKEN}" >> .npmrc

# Install dependencies
RUN npm ci

# Copy source (including linked collab-common)
COPY . .

# Build
RUN npm run build

# Production stage - serve with nginx (unprivileged for OpenShift)
FROM nginxinc/nginx-unprivileged:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
