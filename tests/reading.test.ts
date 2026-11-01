import { discussReview } from '../packages/coach/src/discussion.ts'
import { resourceReason } from '../packages/coach/src/reading.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerPreview, recommendationPreview, sentences } from '../packages/coach/src/reading.ts'
test('resource display keeps mana limits and unavailable-action qualifiers readable', () => {
  assert.equal(
    resourceReason('needs 75 mana, only 26.000024795532227 available'),
    '需要 75 魔法，当前 26',
  )
  assert.equal(resourceReason('cooldown=7.0999860763549805'), '冷却剩余约 7.1 秒')
  assert.match(
    resourceReason('activation is unverified (may be passive); do not propose an immediate cast'),
    /未确认.*不能/,
  )
})
test('card previews preserve complete conditions, negations and numeric precision', () => {
  const text = '5:24 时只有26蓝。建议先后撤；如果蓝量不足，不要使用回城卷轴。录像没有确认敌方视野。'
  assert.equal(recommendationPreview(text), '建议先后撤；如果蓝量不足，不要使用回城卷轴。')
  assert.equal(
    answerPreview('不能直接回城。需要75蓝，当前只有26。\n\n更早的窗口在5:08。'),
    '不能直接回城。需要75蓝，当前只有26。',
  )
  assert.ok(sentences('冷却还剩0.25秒。不要提前认定可用。')[0]!.includes('0.25'))
  const long = '如果敌方还有控制，' + '先等待并确认退路，'.repeat(35) + '不要强行回城。'
  assert.equal(
    recommendationPreview(long),
    long,
    'long sentences are not silently clipped across prerequisites',
  )
})

test('oversized or malformed display summaries fall back without losing or regenerating the answer', async () => {
  const session = {
    locale: 'zh',
    player: { hero: 'Razor', slot: 0, team: 2 },
    players: [],
    report: { duration: 600, stages: [], evidence: [] },
    discussion: [],
  } as any
  const turn = { question: '请概括这局', id: 'reading-test' } as any
  for (const brief of [
    { conclusion: '结论', steps: ['条件'.repeat(70), '行动'.repeat(70)] },
    { conclusion: '结论', steps: [42] },
  ]) {
    let calls = 0
    const model = {
      complete: async () => {
        calls++
        return JSON.stringify({
          answer: '不能直接使用回城卷轴。需要先满足魔法条件。',
          brief,
          citations: [],
        })
      },
    } as any
    const out = await discussReview(
      session,
      turn,
      model,
      { provider: 'fixture', model: 'fixture' },
      {} as any,
      {} as any,
      new AbortController().signal,
    )
    assert.equal(out.brief, undefined)
    assert.match(out.answer, /不能直接/)
    assert.equal(calls, 1)
  }
})
