type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone
  children: React.ReactNode
}) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}
