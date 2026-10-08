/**
 * ViewBar.tsx — the controls that make the grid a tool rather than a picture.
 *
 * Four independent things an operator needs on a wide table, kept in one strip
 * so they do not compete with the filters: how the rows are shown (table or
 * cards), how dense the rows are, which columns are visible, and how to get the
 * result out of the app.
 */
import { useEffect, useRef, useState } from 'react'
import type { SheetColumn, SheetGroup } from './Sheet'

export type Density = 'rapat' | 'nyaman' | 'lega'

/** Row height per density. Fed straight to <Sheet rowHeight>. */
export const DENSITY_H: Record<Density, number> = {
  rapat: 24,
  nyaman: 30,
  lega: 38,
}

const DENSITY_LABEL: Record<Density, string> = {
  rapat: 'Rapat',
  nyaman: 'Nyaman',
  lega: 'Lega',
}

export type ViewMode = 'tabel' | 'kartu'

export interface ViewBarProps<T> {
  view: ViewMode
  onView: (v: ViewMode) => void
  density: Density
  onDensity: (d: Density) => void
  columns: SheetColumn<T>[]
  groups?: SheetGroup[]
  hidden: ReadonlySet<string>
  onHidden: (next: Set<string>) => void
  onExport: () => void
  selectedCount?: number
  onClearSelection?: () => void
  /** Extra controls (export format, etc.) rendered at the end. */
  children?: React.ReactNode
}

export default function ViewBar<T>({
  view,
  onView,
  density,
  onDensity,
  columns,
  groups,
  hidden,
  onHidden,
  onExport,
  selectedCount = 0,
  onClearSelection,
  children,
}: ViewBarProps<T>) {
  const [colsOpen, setColsOpen] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)

  // Close the popover on outside click or Escape — a menu that traps the user
  // behind a modal scrim is worse than no menu at all.
  useEffect(() => {
    if (!colsOpen) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [colsOpen])

  const visibleCount = columns.length - hidden.size

  const toggle = (key: string) => {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onHidden(next)
  }

  /** Grouped list so the picker reads like the schema, not like a flat dump. */
  const byGroup = (() => {
    const g = new Map<string, SheetColumn<T>[]>()
    for (const c of columns) {
      const list = g.get(c.group) ?? []
      list.push(c)
      g.set(c.group, list)
    }
    if (groups?.length) {
      const ordered = new Map<string, SheetColumn<T>[]>()
      for (const grp of groups) {
        const owned = g.get(grp.label)
        if (owned) ordered.set(grp.label, owned)
      }
      for (const [k, v] of g) if (!ordered.has(k)) ordered.set(k, v)
      return ordered
    }
    return g
  })()

  return (
    <div className="viewbar">
      {/* View mode */}
      <div className="segmented" role="group" aria-label="Mode tampilan">
        {(['tabel', 'kartu'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`segmented__btn${view === v ? ' segmented__btn--on' : ''}`}
            aria-pressed={view === v}
            onClick={() => onView(v)}
          >
            <span aria-hidden="true" className="segmented__ico">
              {v === 'tabel' ? '▤' : '▦'}
            </span>
            {v === 'tabel' ? 'Tabel' : 'Kartu'}
          </button>
        ))}
      </div>

      {/* Density — only meaningful for the grid. */}
      {view === 'tabel' && (
        <div className="segmented segmented--sm" role="group" aria-label="Kerapatan baris">
          {(Object.keys(DENSITY_H) as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`segmented__btn${density === d ? ' segmented__btn--on' : ''}`}
              aria-pressed={density === d}
              onClick={() => onDensity(d)}
              title={`Tinggi baris ${DENSITY_H[d]}px`}
            >
              {DENSITY_LABEL[d]}
            </button>
          ))}
        </div>
      )}

      {/* Column picker */}
      <div className="viewbar__pop" ref={popRef}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-expanded={colsOpen}
          aria-haspopup="true"
          onClick={() => setColsOpen((o) => !o)}
        >
          Kolom <span className="viewbar__n">{visibleCount}/{columns.length}</span>
        </button>
        {colsOpen && (
          <div className="colpop" role="dialog" aria-label="Pilih kolom">
            <div className="colpop__head">
              <strong>Kolom tampil</strong>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onHidden(new Set())}>
                Semua
              </button>
            </div>
            <div className="colpop__body">
              {[...byGroup].map(([group, cols]) => (
                <fieldset className="colpop__group" key={group}>
                  <legend>{group || 'Lainnya'}</legend>
                  {cols.map((c) => (
                    <label className="colpop__item" key={c.key}>
                      <input
                        type="checkbox"
                        className="sheet__check"
                        checked={!hidden.has(c.key)}
                        onChange={() => toggle(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <p className="colpop__note">
              Kolom <b>#</b> dan kolom beku selalu tampil.
            </p>
          </div>
        )}
      </div>

      {/* Export */}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onExport}>
        ⭳ Ekspor CSV
        {selectedCount > 0 && <span className="viewbar__n">{selectedCount}</span>}
      </button>

      {selectedCount > 0 && onClearSelection && (
        <span className="viewbar__sel" aria-live="polite">
          {selectedCount} dipilih
          <button type="button" className="viewbar__link" onClick={onClearSelection}>
            bersihkan
          </button>
        </span>
      )}

      {children}
    </div>
  )
}
