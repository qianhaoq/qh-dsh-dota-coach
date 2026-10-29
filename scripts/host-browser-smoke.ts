/** Exercise the installed release inside the real, fresh DSH web profile. */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
const homeFile = process.env.DOTA_KEEP_SMOKE_HOME
if (!homeFile)
  throw new Error('Set DOTA_KEEP_SMOKE_HOME to the path file produced by installed-smoke.ts')
const home = (await readFile(homeFile, 'utf8')).trim()
const require = createRequire(import.meta.url)
const manifestFile = require.resolve('@deepseek-ai/dsh/package.json')
const cli = join(dirname(manifestFile), JSON.parse(await readFile(manifestFile, 'utf8')).bin.dsh)
const child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', '4189'], {
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  const url = await new Promise<string>((resolve, reject) => {
    let log = ''
    const timer = setTimeout(
      () => reject(new Error('Fresh DSH web profile did not start within 60 seconds')),
      60000,
    )
    const output = (buffer: Buffer) => {
      log = (log + buffer.toString()).slice(-64000)
      const url = log.match(/http:\/\/127\.0\.0\.1:4189\/\?token=[^\s]+/)?.[0]
      if (url) {
        clearTimeout(timer)
        resolve(url)
      }
    }
    child.stdout!.on('data', output)
    child.stderr!.on('data', output)
    child.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('DSH exited before browser acceptance'))
    })
  })
  browser = await chromium.launch({ channel: 'chromium' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  const nav = page.getByRole('button', { name: 'Dota coach', exact: true })
  await expect(nav).toBeVisible()
  await page.waitForTimeout(1500)
  // Host first-run notices: close the welcome prompt without supplying credentials.
  const preview = page.getByRole('button', { name: 'Continue', exact: true })
  if (await preview.isVisible()) await preview.click()
  await page
    .getByText('Get started', { exact: true })
    .waitFor({ timeout: 3000 })
    .catch(() => {})
  await page.keyboard.press('Escape')
  await nav.click()
  await expect(page.getByRole('heading', { name: 'Dota coach', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click()
  await page.getByRole('combobox', { name: 'Search', exact: true }).selectOption('sources')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('button', { name: /Installed plugin test/ }).click()
  await expect(page.locator('.dota-body')).toContainText(
    'A synthetic readable source for the packaged installation test.',
  )
  expect(errors).toEqual([])
  await mkdir(resolve('test-results'), { recursive: true })
  await page.screenshot({ path: 'test-results/dsh-installed.png', fullPage: true })
  console.log('Real DSH sidebar, client factory, generated Remote and shared SQLite source passed')
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  await closed
  clearTimeout(force)
}
