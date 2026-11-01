import { test, expect } from '@playwright/test'
test('guided review stays in the workspace, saves one goal and restores after reload', async ({
  page,
}) => {
  await page.goto('/?guided=1')
  await page.getByRole('button', { name: '◈ DOTA COACH 每次进步一个选择' }).click()
  await page
    .getByRole('textbox', { name: '比赛 ID 或链接', exact: true })
    .fill('https://www.opendota.com/matches/424242')
  await page.getByRole('button', { name: '开始复盘 →', exact: true }).click()
  await page.getByRole('button', { name: 'Razor 天辉', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这一刻，你最想优先完成什么？' })).toBeVisible()
  await expect(page.getByRole('button', { name: '展开事后全图', exact: true })).toBeDisabled()
  await expect(page.getByRole('img', { name: '战术回放地图' })).toBeVisible()
  await page.getByRole('button', { name: 'B 和队友配合或接应队友 ↗', exact: true }).click()
  await expect(page.getByRole('heading', { name: '判断的边界', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '展开事后全图', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('heading', { name: '判断的边界', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确定下一局的练习 →', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '今天，只练这一件事。', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '保存这一项练习 →', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '下一局，就从这里开始。', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '下一局，就从这里开始。', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /回看时刻 01/ }).click()
  await expect(page.getByRole('heading', { name: '现场事实', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '记录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '行动前确认队友', exact: true })).toHaveCount(1)
})
