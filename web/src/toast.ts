/**
 * src/toast.ts — tiny module-level toast bus.
 * Usage: toast.error('…') / toast.info('…', { action }).
 * Silent by default — only failures and async-notice items route here.
 */

export interface ToastItem {
  id: number
  tone: 'error' | 'info'
  message: string
  action?: { label: string; run: () => void }
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
const listeners = new Set<Listener>()
let seq = 0

function emit() {
  for (const l of listeners) l([...items])
}

function push(item: Omit<ToastItem, 'id'>, ttlMs: number) {
  const id = ++seq
  items = [...items, { ...item, id }].slice(-4)
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, ttlMs)
}

export const toast = {
  error(message: string, action?: ToastItem['action']) {
    push({ tone: 'error', message, action }, action ? 12000 : 6000)
  },
  info(message: string) {
    push({ tone: 'info', message }, 4000)
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    fn([...items])
    return () => listeners.delete(fn)
  },
}
