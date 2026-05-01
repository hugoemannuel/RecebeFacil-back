FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

RUN mkdir -p /app/uploads && npx prisma generate

EXPOSE 3001
CMD ["npm", "run", "start:prod"]
