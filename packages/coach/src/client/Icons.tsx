export type IconName =
  | 'mark'
  | 'arrow'
  | 'back'
  | 'sliders'
  | 'history'
  | 'check'
  | 'refresh'
  | 'play'
  | 'book'
  | 'focus'
  | 'close'
  | 'signal'
const paths: Record<IconName, string> = {
  mark: 'M5 4h14v16H5z M9 8l6 8 M14 8h1v2 M9 14v2h1',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  history: 'M4 10a8 8 0 1 1 1 8M4 4v6h6m2-3v5l3 2',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
  play: 'm9 5 11 7-11 7z',
  book: 'M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 1 4 4 0 0 0-4-1H3z',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 12h6m-3-3v6',
  close: 'm6 6 12 12M6 18 18 6',
  signal: 'M3 8a16 16 0 0 1 18 0M6 12a11 11 0 0 1 12 0m-9 4a5 5 0 0 1 6 0m-3 4h.01',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
