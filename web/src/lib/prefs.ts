/**
 * prefs.ts — small persisted-preference hook.
 *
 * View mode, row density and the chosen columns are working preferences, not
 * data: they belong to the operator and should survive a reload without a
 * round-trip. Everything is namespaced and read defensively — a corrupt or
 * absent entry falls back to the default rather than throwing during render.
 */
import { useEffect, useState } from 'react'

const NS = 'em:'

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(NS + key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(NS + key, JSON.stringify(value))
    } catch {
      /* private mode / quota — a lost preference must not break the screen */
    }
  }, [key, value])

  return [value, setValue] as const
}
