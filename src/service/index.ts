/**
 * Entry point for the quick-export local host service. Run with `npm run service`
 * (dev, via tsx) or `node dist/service/index.js` (built).
 *
 * Stateless: it opens no Aras connection of its own and stores nothing between requests.
 * Each POST /export carries its own {url, database, token} and runs in its own child process.
 */
import { startServer, DEFAULT_PORT, SERVICE_NAME } from './server.js'

const VERSION = '0.1.0'

async function main(): Promise<void> {
  const port = Number(process.env.QUICK_EXPORT_PORT ?? DEFAULT_PORT)
  try {
    const { port: bound } = await startServer({ version: VERSION }, port)
    // eslint-disable-next-line no-console
    console.log(`${SERVICE_NAME} v${VERSION} listening on http://127.0.0.1:${bound}`)
    console.log(`  GET  /health`)
    console.log(`  POST /export`)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Set QUICK_EXPORT_PORT to a free port and retry.`)
    } else {
      console.error(`Failed to start ${SERVICE_NAME}: ${err.message}`)
    }
    process.exitCode = 1
  }
}

void main()
