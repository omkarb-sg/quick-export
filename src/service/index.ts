/**
 * Entry point for the quick-export local host service. Run with `npm run service`
 * (dev, via tsx) or `node dist/service/index.js` (built).
 *
 * Stateless: it opens no Aras connection of its own and stores nothing between requests.
 * Each POST /export carries its own {url, database, token} and runs in its own child process.
 *
 * The port is FIXED (DEFAULT_PORT): the extension reaches the service through a pinned
 * host_permissions entry in the manifest, so a movable port would silently break the extension.
 * Startup is collision-tolerant — if the port is already served by another quick-export instance
 * (e.g. boot Windows service vs. login launcher racing), we defer instead of crashing.
 */
import { SERVICE_NAME, startServiceTolerant } from './server.js'

const VERSION = '0.1.0'

async function main(): Promise<void> {
  const outcome = await startServiceTolerant({ version: VERSION })
  switch (outcome.status) {
    case 'listening':
      // eslint-disable-next-line no-console
      console.log(`${SERVICE_NAME} v${VERSION} ${outcome.message}`)
      console.log(`  GET  /health`)
      console.log(`  POST /export`)
      break
    case 'deferred':
      console.log(`${SERVICE_NAME} v${VERSION}: ${outcome.message}`)
      break
    case 'error':
      console.error(`${SERVICE_NAME}: ${outcome.message}`)
      process.exitCode = 1
      break
  }
}

void main()
