/**
 * Input + Textarea + Label — H3ROS form primitives.
 *
 * Underlined (bottom-border-only), not boxed. Focus border → Arc Cyan.
 * No box, no box-shadow, no radius. Label sits above (mono caps eyebrow).
 */
import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, ReactNode } from 'react'
import EyebrowLabel from '../brand/EyebrowLabel'

const baseFieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--color-n400)',
  borderRadius: 0,
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 400,
  fontSize: 15,
  lineHeight: 1.3,
  color: 'var(--color-ink)',
  padding: '8px 0',
  outline: 'none',
  transition: 'border-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}

// ─── Label ──────────────────────────────────────────────────────────────────
type LabelProps = {
  children: ReactNode
  htmlFor?: string
  className?: string
  style?: React.CSSProperties
}
export function Label({ children, htmlFor, className, style }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className={className} style={{ display: 'block', marginBottom: 8, ...style }}>
      <EyebrowLabel keyword={typeof children === 'string' ? children : String(children)} />
    </label>
  )
}

// ─── Input ──────────────────────────────────────────────────────────────────
type InputProps = {
  label?: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, style, onFocus, onBlur, ...rest },
  ref
) {
  const inputId = id || (label ? `in_${label.toLowerCase().replace(/\s+/g, '_')}` : undefined)
  return (
    <div style={{ width: '100%' }}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <input
        ref={ref}
        id={inputId}
        style={{
          ...baseFieldStyle,
          borderBottomColor: error ? 'var(--color-signal)' : 'var(--color-n400)',
          ...style,
        }}
        onFocus={(e) => {
          if (!error) e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)'
          onFocus?.(e)
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = error ? 'var(--color-signal)' : 'var(--color-n400)'
          onBlur?.(e)
        }}
        {...rest}
      />
      {error && (
        <p style={{
          fontFamily: 'var(--font-plex-mono), monospace',
          fontSize: 11,
          color: 'var(--color-signal)',
          marginTop: 6,
        }}>{error}</p>
      )}
    </div>
  )
})

// ─── Textarea ───────────────────────────────────────────────────────────────
type TextareaProps = {
  label?: string
  error?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, style, onFocus, onBlur, ...rest },
  ref
) {
  const taId = id || (label ? `ta_${label.toLowerCase().replace(/\s+/g, '_')}` : undefined)
  return (
    <div style={{ width: '100%' }}>
      {label && <Label htmlFor={taId}>{label}</Label>}
      <textarea
        ref={ref}
        id={taId}
        style={{
          ...baseFieldStyle,
          minHeight: 96,
          resize: 'vertical',
          borderBottomColor: error ? 'var(--color-signal)' : 'var(--color-n400)',
          ...style,
        }}
        onFocus={(e) => {
          if (!error) e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)'
          onFocus?.(e)
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = error ? 'var(--color-signal)' : 'var(--color-n400)'
          onBlur?.(e)
        }}
        {...rest}
      />
      {error && (
        <p style={{
          fontFamily: 'var(--font-plex-mono), monospace',
          fontSize: 11,
          color: 'var(--color-signal)',
          marginTop: 6,
        }}>{error}</p>
      )}
    </div>
  )
})

export default Input
