FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package.json
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install
COPY client client
COPY server server
RUN npm --workspace client run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package.json
COPY server/package.json server/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server /app/server
COPY --from=build /app/client/dist /app/client/dist
EXPOSE 3000
CMD ["node", "server/index.js"]
