# SA360

## Local setup

1. Install Node.js, pnpm, Docker Desktop
2. Start containers:
   docker compose -f infra/docker-compose.yml up -d
3. Generate Prisma client:
   pnpm prisma:generate
4. Run migrations:
   pnpm prisma:migrate --name init
5. Seed test client:
   pnpm prisma:seed
6. Build shared package:
   pnpm --filter @sa360/shared build
7. Start API:
   pnpm dev:api
8. Start worker:
   pnpm dev:worker

## Health checks

- GET /health
- GET /health/db
- GET /health/queue