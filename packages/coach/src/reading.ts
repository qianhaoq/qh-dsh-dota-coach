/** Extractive presentation only: never cut a sentence, drop a negation or invent a summary. */
export function sentences(text: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)]
    .map((s) => s.segment.trim())
    .filter(Boolean)
}
export function recommendationPreview(text: string): string {
  const parts = sentences(text)
  return parts.find((p) => /建议|recommend|suggest/i.test(p)) || parts[0] || text.trim()
}
export function answerPreview(text: string): string {
  const paragraph =
    text
      .split(/\n\s*\n/)
      .find((p) => p.trim())
      ?.trim() || ''
  if (paragraph.length <= 190) return paragraph
  const parts = sentences(paragraph),
    out: string[] = []
  for (const p of parts) {
    if (out.length && out.join('').length + p.length > 190) break
    out.push(p)
    if (out.length >= 2) break
  }
  return out.join(' ')
}
/** Format machine-checked reasons without changing the underlying resource decision. */
export function resourceReason(text: string, en = false): string {
  const mana = text.match(/^needs ([\d.]+) mana, only ([\d.]+) available$/)
  if (mana)
    return en
      ? `Needs ${Number(mana[1])} mana; available ${Math.floor(Number(mana[2]))}`
      : `需要 ${Number(mana[1])} 魔法，当前 ${Math.floor(Number(mana[2]))}`
  const cooldown = text.match(/^cooldown=([\d.]+)$/)
  if (cooldown)
    return en
      ? `About ${Number(cooldown[1]).toFixed(1)}s cooldown left`
      : `冷却剩余约 ${Number(cooldown[1]).toFixed(1)} 秒`
  if (en) return text
  const known: Record<string, string> = {
    'activation is unverified (may be passive); do not propose an immediate cast':
      '未确认可主动使用，不能认定此刻可施放',
    'ability is not learned': '此刻尚未学习',
    'hero is dead or life state unknown': '英雄已死亡，或存活状态未确认',
    'no stored charges': '没有可用充能',
    'mana requirement or current mana unknown': '耗蓝或当前魔法未确认',
    'not present in the decision-time snapshot; ownership or learning is unverified':
      '此刻快照未记录，是否拥有或学会仍未知',
  }
  return known[text] || text
}
