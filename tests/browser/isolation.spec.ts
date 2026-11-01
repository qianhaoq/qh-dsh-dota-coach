import { test, expect, type Page } from '@playwright/test'

async function reviews(page: Page) {
  const response = await page.request.post('/api/call', {
    data: { tool: 'dota_coach', args: { action: 'list' } },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test('browser contexts isolate active reviews while preserving progress across reloads', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/?guided=1')
  await page.getByRole('textbox', { name: '比赛 ID 或链接', exact: true }).fill('424242')
  await page.getByRole('button', { name: '开始复盘 →', exact: true }).click()
  await page.getByRole('button', { name: 'Razor 天辉', exact: true }).click()
  await page.getByRole('button', { name: 'B 和队友配合或接应队友 ↗', exact: true }).click()
  await expect(page.getByRole('heading', { name: '判断的边界', exact: true })).toBeVisible()
  const guided = await reviews(page)
  expect(guided.items).toHaveLength(1)
  expect(guided.items[0].phase).toBe('explanation')

  const otherContext = await browser.newContext({ baseURL })
  try {
    const report = await otherContext.newPage()
    await report.goto('/')
    await expect(report.getByRole('textbox', { name: '比赛 ID 或链接', exact: true })).toBeVisible()
    expect((await reviews(report)).items).toEqual([])
    await report.getByRole('textbox', { name: '比赛 ID 或链接', exact: true }).fill('424242')
    await report.getByRole('button', { name: '开始复盘', exact: true }).click()
    await report.getByRole('button', { name: 'Razor 天辉', exact: true }).click()
    await expect(report.locator('[data-a2ui-version="v0.9.1"] .dc-ui-card')).toHaveCount(3)
    const savedReport = await reviews(report)
    expect(savedReport.items).toHaveLength(1)
    expect(savedReport.items[0].format).toBe('report')
    expect(savedReport.active_id).not.toBe(guided.active_id)

    await page.reload()
    await expect(page.getByRole('heading', { name: '判断的边界', exact: true })).toBeVisible()
    expect(await reviews(page)).toEqual(guided)
    await report.reload()
    await expect(report.locator('[data-a2ui-version="v0.9.1"] .dc-ui-card')).toHaveCount(3)
    expect((await reviews(report)).active_id).toBe(savedReport.active_id)
  } finally {
    await otherContext.close()
  }
})
