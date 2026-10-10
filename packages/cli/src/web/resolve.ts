import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ENV_OVERRIDE = 'ZOOID_DEV_WEB_ROOT_OVERRIDE'

// The web UI package in this repo: packages/web, next to packages/cli.
export function webPackageDir(cliRoot: string): string {
  return join(dirname(cliRoot), 'web')
}

export function resolveWebRoot(cliRoot: string): string {
  const override = process.env[ENV_OVERRIDE]
  if (override && existsSync(join(override, 'index.html'))) return resolve(override)

  const dist = join(webPackageDir(cliRoot), 'dist')
  if (existsSync(join(dist, 'index.html'))) return dist
  throw new Error(`No web UI build at ${dist}. Run \`pnpm -C packages/web build\`.`)
}
