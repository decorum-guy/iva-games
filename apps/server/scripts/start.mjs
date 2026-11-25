import { fileURLToPath } from 'node:url'

// npm workspace scripts run from apps/server. Preserve the root launcher's
// relative database/static paths instead of creating a second set of saves.
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)))
await import(new URL('../../../dist-server/main.js', import.meta.url).href)
