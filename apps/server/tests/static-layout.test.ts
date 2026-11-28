import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOnlineServer } from '../src/http'

async function withStaticFiles(files: Record<string, string>, check: (origin: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'chess-2-static-'))
  const app = createOnlineServer({ databasePath: ':memory:', staticDir: directory })
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(directory, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    const { port } = await app.listen(0)
    await check(`http://127.0.0.1:${port}`)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
}

describe('workspace production entry points', () => {
  it('serves the distinct entries and unchanged asset URLs from a combined build', async () => {
    await withStaticFiles({
      'index.html': '<title>Chess catalogue</title>',
      'remorse/index.html': '<title>REMORSE</title>',
      'overdrive/index.html': '<title>OVERDRIVE</title>',
      'assets/overdrive/entry.js': 'export const game = "overdrive"',
    }, async origin => {
      expect(await (await fetch(origin + '/')).text()).toBe('<title>Chess catalogue</title>')
      for (const path of ['/remorse', '/remorse/', '/remorse/room']) {
        const response = await fetch(origin + path)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('<title>REMORSE</title>')
      }
      for (const path of ['/overdrive', '/overdrive/', '/overdrive/room']) {
        const response = await fetch(origin + path)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('<title>OVERDRIVE</title>')
      }
      const script = await fetch(origin + '/assets/overdrive/entry.js')
      expect(script.headers.get('content-type')).toContain('application/javascript')
      expect(await script.text()).toBe('export const game = "overdrive"')
      const head = await fetch(origin + '/overdrive/', { method: 'HEAD' })
      expect(head.headers.get('content-length')).toBe(String('<title>OVERDRIVE</title>'.length))
      expect(await head.text()).toBe('')
    })
  })

  it('keeps invitation paths usable when STATIC_DIR points to the standalone Overdrive output', async () => {
    await withStaticFiles({ 'index.html': '<title>OVERDRIVE standalone</title>' }, async origin => {
      for (const path of ['/', '/overdrive/', '/overdrive/room']) {
        const response = await fetch(origin + path)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('<title>OVERDRIVE standalone</title>')
      }
      for (const path of ['/assets/missing.js', '/assets/overdrive/models/missing.glb', '/overdrive/missing.js']) {
        const response = await fetch(origin + path)
        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toContain('application/json')
      }
    })
  })
})
