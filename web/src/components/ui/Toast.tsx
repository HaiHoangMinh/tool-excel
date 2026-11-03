import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastItem = { id: number; message: string; tone: 'info' | 'success' | 'error' }

type ToastCtx = { push: (message: string, tone?: ToastItem['tone']) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 3200)
  }, [])
  const value = useMemo(() => ({ push }), [push])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside provider')
  return ctx
}
