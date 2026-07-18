import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "@/app/generated/prisma/client";

// Prisma 7 no longer reads `datasource.url` from schema.prisma — the client
// must be constructed with an explicit driver adapter. We use the Neon
// serverless driver adapter since this app targets Neon Postgres, which
// works both in normal Node.js runtimes and on serverless/edge deploys
// (e.g. Vercel) without needing a persistent TCP connection.
// https://www.prisma.io/docs/orm/overview/databases/neon
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;

function createPrismaClient() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in a real Neon connection string.",
    );
  }

  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

// Standard Next.js Prisma client singleton, using a globalThis cache so
// hot-reloading in dev (and serverless/edge cold starts) don't spin up a
// new PrismaClient — and a new connection pool — on every module reload.
// https://www.prisma.io/docs/orm/more/help-and-troubleshooting/help-articles/nextjs-prisma-client-dev-practices

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
