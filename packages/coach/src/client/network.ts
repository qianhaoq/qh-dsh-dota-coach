/** Transport failure is different from a validated model/domain error. Never retry writes here. */
export function isConnectionError(error: unknown): boolean {
  return /Failed to fetch|fetch failed|NetworkError|Load failed|network request failed|connection (?:closed|lost|refused)|remote.*(?:unavailable|disconnect)|ECONNREFUSED/i.test(
    String(error instanceof Error ? error.message : error),
  )
}
export function errorMessage(error: unknown, en = false): string {
  if (isConnectionError(error))
    return en
      ? 'The local DSH service is disconnected. Your draft is kept. Reconnect to check the latest saved state.'
      : '暂时无法连接本地 DSH。草稿已保留，重连后会核对最新保存的进度。'
  const value = error instanceof Error ? error.message : String(error)
  if (/401|unauthorized|forbidden|authentication/i.test(value))
    return en
      ? 'DSH authentication expired. Reopen DSH from its local launch link.'
      : 'DSH 登录状态已过期，请从本地启动链接重新打开。'
  return value
}
export function readDraft<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem('dota-coach:' + key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}
export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem('dota-coach:' + key, JSON.stringify(value))
  } catch {
    /* Storage can be unavailable; keep the React draft. */
  }
}
