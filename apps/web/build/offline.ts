import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

export function offline(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'calligra-offline',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    closeBundle() {
      const directory = resolve(config.root, config.build.outDir)
      const files = readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll('\\', '/'))
        .filter((name) => name !== 'service-worker.js' && name !== '.nojekyll')
        .sort()
      const template = readFileSync(resolve(config.root, 'build/service-worker.js'), 'utf8')
      const digest = createHash('sha256').update(template)
      const fonts: Record<string, string> = {}
      const shell = []
      for (const name of files) {
        const bytes = readFileSync(resolve(directory, name))
        const checksum = createHash('sha256').update(bytes).digest('hex')
        digest.update(JSON.stringify([name, checksum]))
        if (/^fonts\/.*\.(?:gzip|woff2)$/.test(name)) fonts[name] = checksum
        else shell.push(name)
      }
      const source = template
        .replace('@@REVISION@@', digest.digest('hex'))
        .replace('@@SHELL@@', JSON.stringify(shell))
        .replace('@@FONTS@@', JSON.stringify(fonts))
      writeFileSync(resolve(directory, 'service-worker.js'), source, 'utf8')
    },
  }
}
