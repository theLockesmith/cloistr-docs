# Build stage
FROM node:22.23.3-alpine AS builder

WORKDIR /app

# Copy package files and registry config
COPY package.json package-lock.json .npmrc ./

# Auth token passed as build arg
ARG NPM_TOKEN
RUN echo "//git.coldforge.xyz/api/v4/projects/44/packages/npm/:_authToken=${NPM_TOKEN}" >> .npmrc

# Install dependencies
RUN npm install -g npm@11 --quiet
RUN npm ci

# Copy source (including linked collab-common)
COPY . .

# Vite env vars (must be set before build)
ARG VITE_RELAY_URL=wss://relay.cloistr.xyz
ARG VITE_BLOSSOM_URL=https://files.cloistr.xyz
ENV VITE_RELAY_URL=${VITE_RELAY_URL}
ENV VITE_BLOSSOM_URL=${VITE_BLOSSOM_URL}

# Build
RUN npm run build

# Production stage - serve with nginx (unprivileged for OpenShift)
FROM nginxinc/nginx-unprivileged:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# The serving config goes to the TEMPLATE directory, not the active config
# directory. The base image substitutes it at startup, before nginx starts, so
# there is no entrypoint override and no script of ours to maintain.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Trailing slashes are stripped from the CLOISTR_*_URL values before the
# template step, so a slash in a deployment's environment cannot render a
# doubled one. The base image sources *.envsh in name order; 20- is the
# template step. The file is committed executable: the entrypoint skips it
# otherwise.
COPY 18-cloistr-trim-url-slashes.envsh /docker-entrypoint.d/18-cloistr-trim-url-slashes.envsh

# Production values as defaults, so an image given no environment resolves to
# production. That is what makes this safe to adopt on a live service: unset
# means production, structurally, rather than by anyone remembering to set it.
# CLOISTR_SIGNER_URL also sets the /signer/ proxy upstream, the only path this
# app uses to reach the signer.
#
# The filter is NOT optional. Without it the substitution tool replaces every
# $NAME it recognises as a defined environment variable, and the serving config
# contains nginx's own $uri, $remote_addr and $proxy_host.
ENV CLOISTR_RELAY_URL=wss://relay.cloistr.xyz \
    CLOISTR_SIGNER_URL=https://signer.cloistr.xyz \
    CLOISTR_BLOSSOM_URL=https://files.cloistr.xyz \
    CLOISTR_DISCOVERY_URL=https://discover.cloistr.xyz \
    CLOISTR_APP_URL=https://docs.cloistr.xyz \
    CLOISTR_ENVIRONMENT=production \
    NGINX_ENVSUBST_FILTER=^CLOISTR_

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
