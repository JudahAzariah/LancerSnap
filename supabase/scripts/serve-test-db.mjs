// Serves a throwaway, in-memory Postgres (PGlite) with every migration applied,
// over the normal Postgres wire protocol, for the backend's tests.
// Usage: node scripts/serve-test-db.mjs <port>
// Never used in production and never connected to a real Supabase project.
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import { createDatabase } from '../tests/helpers.mjs';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: node scripts/serve-test-db.mjs <port>');
  process.exit(2);
}

const db = await createDatabase();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
await server.start();
console.log(`READY ${port}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
