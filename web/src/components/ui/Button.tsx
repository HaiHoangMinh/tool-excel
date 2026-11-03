import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--${variant} ui-btn--${size} ${className}`.trim()}
      {...rest}
    >
      {icon ? <span className="ui-btn__icon">{icon}</span> : null}
      {children}
    </button>
  )
}
