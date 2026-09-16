/**
 * ACR OpsRoom Server Entry Point
 */

import { OpsRoomServer } from './server.js';

export * from './server.js';

if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  const port = parseInt(process.env.ACR_OPSROOM_PORT || '20447', 10);
  const server = new OpsRoomServer({ port });
  server.start().then((activePort) => {
    console.log(`[acr-opsroom] Autonomous War Room Server online on port ${activePort}`);
  }).catch((err) => {
    console.error(`[acr-opsroom] Failed to start server:`, err);
    process.exit(1);
  });
}
