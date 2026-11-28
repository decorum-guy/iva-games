import { test } from '@playwright/test'
import type { Browser, BrowserType } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

async function bounded<T>(operation: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds) })])
  } finally { clearTimeout(timer) }
}

async function ownEndpoint(profile: string): Promise<string | null> {
  const file = await open(join(profile, 'DevToolsActivePort'), 'r').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('NATIVE_FOCUS_ENDPOINT_READ_FAILED')
  })
  if (!file) return null
  try {
    // Chromium creates this file in our fresh profile. Read at most 4 KiB;
    // neither its endpoint nor the temporary profile is printed to CI output.
    const buffer = Buffer.alloc(4097), { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 4096) throw new Error('NATIVE_FOCUS_ENDPOINT_TOO_LARGE')
    const [portText, browserPath] = buffer.subarray(0, bytesRead).toString('utf8').trim().split(/\r?\n/)
    if (!/^\d{1,5}$/.test(portText ?? '') || !/^\/devtools\/browser\/[a-zA-Z0-9-]{1,128}$/.test(browserPath ?? '')) return null
    const port = Number(portText)
    return port > 0 && port <= 65535 ? `ws://127.0.0.1:${port}${browserPath}` : null
  } finally { await file.close() }
}

async function launchOwnedFocusChromium(chromium: BrowserType): Promise<{ browser: Browser; dispose: () => Promise<void> }> {
  const profile = await mkdtemp(join(tmpdir(), 'iva-forpost-native-focus-'))
  const grouped = process.platform !== 'win32'
  const child = spawn(chromium.executablePath(), [
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-dev-shm-usage',
    // Matches Playwright's default Chromium sandbox choice in the same CI job.
    '--no-sandbox', '--window-size=1440,900', 'about:blank',
  ], { detached: grouped, stdio: ['ignore', 'ignore', 'pipe'] })
  let launchError: string | undefined, exited = false, stderrBytes = 0
  let exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null
  child.once('error', error => { launchError = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN'; exited = true })
  child.once('exit', (code, signal) => { exited = true; exitCode = code; exitSignal = signal })
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length })
  let browser: Browser | undefined, disposal: Promise<void> | undefined

  const groupAlive = () => {
    if (!child.pid) return false
    if (!grouped) return !exited
    try { process.kill(-child.pid, 0); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw new Error('NATIVE_FOCUS_OWN_PROCESS_STATUS_FAILED', { cause: error })
    }
  }
  const signalOwnGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try {
      // The group ID comes only from this detached child; no process search,
      // inherited browser, shared profile or other user's window is involved.
      if (grouped) process.kill(-child.pid, signal)
      else if (!exited) child.kill(signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('NATIVE_FOCUS_OWN_PROCESS_STOP_FAILED', { cause: error })
    }
  }
  const waitStopped = async (milliseconds: number) => {
    const deadline = performance.now() + milliseconds
    while (groupAlive() && performance.now() < deadline) await delay(50)
    return !groupAlive()
  }
  const dispose = () => disposal ??= (async () => {
    if (browser) await bounded(browser.close(), 1500, 'NATIVE_FOCUS_CDP_CLOSE_TIMEOUT').catch(() => {})
    signalOwnGroup('SIGTERM')
    if (!await waitStopped(1500)) {
      signalOwnGroup('SIGKILL')
      if (!await waitStopped(1500)) throw new Error('NATIVE_FOCUS_OWN_PROCESS_DID_NOT_STOP')
    }
    await bounded(rm(profile, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 }), 3000, 'NATIVE_FOCUS_PROFILE_CLEANUP_TIMEOUT')
  })()

  try {
    const deadline = performance.now() + 10_000
    let endpoint: string | null = null
    while (performance.now() < deadline) {
      if (launchError) throw new Error(`NATIVE_FOCUS_CHROMIUM_LAUNCH_FAILED:${launchError}`)
      if (exited) throw new Error(`NATIVE_FOCUS_CHROMIUM_EXITED:code=${exitCode}:signal=${exitSignal}:stderrBytes=${stderrBytes}`)
      endpoint = await bounded(ownEndpoint(profile), 1000, 'NATIVE_FOCUS_ENDPOINT_READ_TIMEOUT')
      if (endpoint) break
      await delay(50)
    }
    if (!endpoint) throw new Error(`NATIVE_FOCUS_CHROMIUM_START_TIMEOUT:stderrBytes=${stderrBytes}`)
    // Public API, present in installed Playwright 1.65.1:
    // https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
    // noDefaults prevents Playwright from enabling focus emulation in the
    // existing default context. It does NOT apply to browser.newContext().
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, isLocal: true, timeout: 10_000 }).catch(() => {
      throw new Error('NATIVE_FOCUS_CDP_CONNECT_FAILED')
    })
    if (browser.contexts().length !== 1) throw new Error('NATIVE_FOCUS_DEFAULT_CONTEXT_UNAVAILABLE')
    return { browser, dispose }
  } catch (error) {
    // Preserve the primary setup failure while making any cleanup failure
    // explicit; no endpoints, process IDs, profile paths or page data are logged.
    try { await dispose() } catch { console.log(JSON.stringify({ nativeFocusFixtureCleanup: 'failed-during-setup' })) }
    throw error
  }
}

const chromiumFocusTest = test.extend({
  browser: [async ({ playwright, browserName, headless }, use) => {
    if (browserName !== 'chromium' || headless) throw new Error('NATIVE_FOCUS_REQUIRES_HEADED_CHROMIUM')
    const owned = await launchOwnedFocusChromium(playwright.chromium)
    try { await use(owned.browser) } finally { await owned.dispose() }
  }, { scope: 'worker' }],
  context: async ({ browser, actionTimeout, navigationTimeout }, use) => {
    const context = browser.contexts()[0]
    if (!context) throw new Error('NATIVE_FOCUS_DEFAULT_CONTEXT_UNAVAILABLE')
    context.setDefaultTimeout(actionTimeout)
    context.setDefaultNavigationTimeout(navigationTimeout)
    await use(context)
    // The owned browser fixture closes this context after afterEach diagnostics.
  },
  page: async ({ context, viewport }, use) => {
    const page = context.pages()[0] ?? await context.newPage()
    if (viewport) await page.setViewportSize(viewport)
    await use(page)
    // Keep the actual page alive for diagnostics; browser teardown owns cleanup.
  },
})

// WebKit keeps its ordinary fixture and the same capability gate. Its driver
// limitation remains an explicit failure, with no private protocol workaround.
export const nativeFocusTest = process.env.FORPOST_BROWSER === 'webkit' ? test : chromiumFocusTest
