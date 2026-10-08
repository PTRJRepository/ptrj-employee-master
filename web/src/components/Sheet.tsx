/**
 * Sheet.tsx — the shared spreadsheet grid.
 *
 * Built for dense data work, not presentation: single-line cells at a constant
 * row height, real cell gridlines, frozen panes, banded rows, and exactly one
 * piece of chrome (the group tab strip) around the table itself.
 *
 * FROZEN PANES
 * ------------
 * A frozen column must be pinned at the left edge, which means it has to be the
 * leftmost column. The render order is therefore: row-number gutter, then every
 * frozen column in the order the caller gave, then the rest. Sticky `left` is
 * measured across that final order, so a frozen column's offset only ever counts
 * the frozen columns before it. (Measuring against the *declared* order is the
 * bug this replaced: a frozen column declared after an unfrozen one is pinned
 * rightward and leaves a dead gap that unfrozen cells scroll through.)
 *
 * ROWS ARE WINDOWED
 * -----------------
 * Only the visible slice is mounted, held in place by two spacer rows. ROW_H
 * below MUST equal `--row-h` in tokens.css; a mismatch desynchronises the
 * scroll offset from the rendered rows.
 *
 * Deliberate limits: fixed row height, no formula bar, no range selection, no
 * drag-fill. Column widths come from the server schema and are not yet draggable.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

/** Numeric-ish kinds are right-aligned with tabular figures. */
export type SheetColumnType = 'string' | 'int' | 'money' | 'date' | 'text'

export interface SheetColumn<T> {
  key: string
  label: string
  /** Group tab this column belongs to ('' = ungrouped, never shown as a tab). */
  group: string
  type: SheetColumnType
  /** Width in px (table-layout: fixed). */
  width: number
  align?: 'start' | 'end'
  editable?: boolean
  /** Where the data lives — 'audit' columns are always read-only. */
  source?: string
  render?: (row: T) => ReactNode
  raw?: (row: T) => string | number | null | undefined
}

export interface SheetGroup {
  label: string
  keys: string[]
}

export interface SheetProps<T> {
  columns: SheetColumn<T>[]
  groups?: SheetGroup[]
  rows: T[]
  rowKey: (row: T) => string | number
  /** Keys pinned to the left, in the order they should appear. */
  frozenKeys?: string[]
  rowNumberOffset?: number
  onRowOpen?: (row: T, index: number) => void
  onCellCommit?: (row: T, key: string, value: string) => void | Promise<void>
  flashKeys?: ReadonlySet<string | number>
  loading?: boolean
  /** Scroll-box height. Defaults to a viewport-relative value. */
  height?: string
  empty?: ReactNode
  ariaLabel?: string
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  /**
   * Row height in px. Applied as the `--row-h` custom property on the grid, so
   * the virtualiser and the CSS are driven by ONE number and cannot desync.
   */
  rowHeight?: number
  /** Render a leading checkbox column with a select-all in the header. */
  selectable?: boolean
  selectedKeys?: ReadonlySet<string | number>
  onSelectChange?: (keys: Set<string | number>) => void
}

/** Default row height. Mirrors the `--row-h` fallback in app.css. */
const DEFAULT_ROW_H = 26
const OVERSCAN = 10
const ROWNUM_KEY = '__rownum__'
const SELECT_KEY = '__select__'
const ROWNUM_W = 44
const SELECT_W = 34

/** Format a value by column type. Empty stays EMPTY — a wall of '–' reads as
 *  data when it is absence, which is the single biggest source of grid noise. */
function formatCell(type: SheetColumnType, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  switch (type) {
    case 'money':
    case 'int': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? new Intl.NumberFormat('id-ID').format(n) : String(value)
    }
    case 'date': {
      const s = String(value)
      const d = new Date(s)
      if (Number.isNaN(d.getTime())) return s.slice(0, 10)
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
    }
    default:
      return String(value)
  }
}

/** The value the inline editor starts from (raw, not display-formatted). */
function editSeed(type: SheetColumnType, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (type === 'date') {
    const s = String(value)
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10)
  }
  return String(value)
}

const isNumeric = (t: SheetColumnType) => t === 'money' || t === 'int' || t === 'date'

export default function Sheet<T extends object>({
  columns,
  groups,
  rows,
  rowKey,
  frozenKeys = [],
  rowNumberOffset = 0,
  onRowOpen,
  onCellCommit,
  flashKeys,
  loading = false,
  height = 'calc(100dvh - 14rem)',
  empty,
  ariaLabel = 'Tabel data',
  sortKey,
  sortDir,
  onSort,
  rowHeight = DEFAULT_ROW_H,
  selectable = false,
  selectedKeys,
  onSelectChange,
}: SheetProps<T>) {
  const ROW_H = rowHeight
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [activeCell, setActiveCell] = useState<{ row: string | number; key: string } | null>(null)
  const [editing, setEditing] = useState<{ row: string | number; key: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const cancelledRef = useRef(false)
  const clickTimer = useRef(0)

  /* ── Column layout. Frozen columns are hoisted to the front so `left` is
     measured across the order actually rendered. ── */
  const layout = useMemo(() => {
    const frozenSet = new Set(frozenKeys)
    const frozenCols = columns.filter((c) => frozenSet.has(c.key))
    const restCols = columns.filter((c) => !frozenSet.has(c.key))
    const all: Array<
      SheetColumn<T> & { left: number; isRownum: boolean; isFrozen: boolean; isSelect: boolean }
    > = [
      {
        key: ROWNUM_KEY,
        label: '#',
        group: '',
        type: 'int',
        width: ROWNUM_W,
        align: 'start',
        editable: false,
        left: 0,
        isRownum: true,
        isFrozen: true,
        isSelect: false,
      },
      ...(selectable
        ? [{
            key: SELECT_KEY,
            label: '',
            group: '',
            type: 'string' as const,
            width: SELECT_W,
            align: 'start' as const,
            editable: false,
            left: 0,
            isRownum: false,
            isFrozen: true,
            isSelect: true,
          }]
        : []),
      ...[...frozenCols, ...restCols].map((c) => ({
        ...c,
        left: 0,
        isRownum: false,
        isFrozen: frozenSet.has(c.key),
        isSelect: false,
      })),
    ]
    let x = 0
    for (const c of all) {
      c.left = x
      x += c.width
    }
    return { all, totalWidth: x }
  }, [columns, frozenKeys, selectable])

  /* ── Windowing ── */
  const total = rows.length
  const visible = Math.max(1, Math.ceil(viewH / ROW_H))
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(total, start + visible + OVERSCAN * 2)
  const slice = useMemo(() => rows.slice(start, end), [rows, start, end])
  const padTop = start * ROW_H
  const padBottom = Math.max(0, (total - end) * ROW_H)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setViewH(el.clientHeight || 600)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    window.clearTimeout(clickTimer.current)
  }, [])

  const scrollToIndex = useCallback((idx: number) => {
    const el = wrapRef.current
    if (!el) return
    const y = idx * ROW_H
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
  }, [])

  const openRowDelayed = useCallback(
    (row: T, index: number) => {
      if (!onRowOpen) return
      if (!onCellCommit) {
        onRowOpen(row, index)
        return
      }
      window.clearTimeout(clickTimer.current)
      clickTimer.current = window.setTimeout(() => onRowOpen(row, index), 220)
    },
    [onRowOpen, onCellCommit],
  )
  const cancelPendingOpen = useCallback(() => window.clearTimeout(clickTimer.current), [])

  /* ── Keyboard: index-based, never DOM-based (rows recycle). ── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!total) return
      const next =
        e.key === 'ArrowDown'
          ? Math.min(total - 1, focusIdx < 0 ? 0 : focusIdx + 1)
          : Math.max(0, focusIdx < 0 ? 0 : focusIdx - 1)
      setFocusIdx(next)
      scrollToIndex(next)
    } else if (e.key === 'Enter' && onRowOpen && focusIdx >= 0 && focusIdx < total) {
      e.preventDefault()
      onRowOpen(rows[focusIdx], focusIdx)
    } else if (e.key === 'Escape') {
      setFocusIdx(-1)
    }
  }

  const jumpToGroup = (g: SheetGroup) => {
    const el = wrapRef.current
    setActiveGroup(g.label)
    if (!el) return
    const first = layout.all.find((c) => g.keys.includes(c.key))
    if (!first) return
    const frozenW = layout.all.filter((c) => c.isFrozen).reduce((n, c) => n + c.width, 0)
    el.scrollTo({ left: Math.max(0, first.left - frozenW + 1), behavior: 'smooth' })
  }

  /* ── Inline edit ── */
  const beginEdit = (row: T, col: SheetColumn<T>) => {
    if (!onCellCommit || !col.editable || col.source === 'audit') return
    const raw = col.raw ? col.raw(row) : (row as Record<string, unknown>)[col.key]
    setEditing({ row: rowKey(row), key: col.key })
    setEditValue(editSeed(col.type, raw))
    cancelledRef.current = false
  }

  const commitEdit = async (row: T, col: SheetColumn<T>) => {
    if (cancelledRef.current) {
      cancelledRef.current = false
      setEditing(null)
      return
    }
    if (!editing || !onCellCommit) return
    const raw = col.raw ? col.raw(row) : (row as Record<string, unknown>)[col.key]
    const seed = editSeed(col.type, raw)
    setEditing(null)
    if (editValue === seed) return // a no-op edit must not write an audit row
    await onCellCommit(row, col.key, editValue)
  }

  const cancelEdit = () => {
    cancelledRef.current = true
    setEditing(null)
  }

  const cellStyle = (c: { left: number; width: number; isFrozen: boolean }): CSSProperties =>
    c.isFrozen ? { position: 'sticky', left: c.left, width: c.width } : { width: c.width }

  return (
    <div className="sheet">
      {groups && groups.length > 1 && (
        <div className="sheet__tabs" role="tablist" aria-label="Kelompok kolom">
          {groups.map((g) => (
            <button
              key={g.label}
              type="button"
              role="tab"
              aria-selected={activeGroup === g.label}
              className={`sheet__tab${activeGroup === g.label ? ' sheet__tab--on' : ''}`}
              onClick={() => jumpToGroup(g)}
            >
              {g.label}
              <span className="sheet__tab-n" aria-hidden="true">
                {g.keys.length}
              </span>
            </button>
          ))}
          {activeGroup && (
            <button
              type="button"
              className="sheet__tab sheet__tab--clear"
              onClick={() => setActiveGroup(null)}
            >
              Semua kolom
            </button>
          )}
        </div>
      )}

      <div
        ref={wrapRef}
        className="sheet__wrap"
        // --row-h drives every cell height AND the virtualiser spacing, so the
        // JS constant and the CSS can never drift apart.
        style={{ height, '--row-h': `${ROW_H}px` } as CSSProperties}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <table className="sheet__table" aria-label={ariaLabel}>
          <colgroup>
            {layout.all.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {layout.all.map((c) => {
                const inActive = !!activeGroup && !!c.group && c.group === activeGroup
                const isActiveCol = activeCell?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={[
                      c.isRownum ? 'sheet__rownum' : '',
                      c.isFrozen && !c.isRownum ? 'sheet__frozen' : '',
                      inActive ? 'sheet__col--on' : '',
                      isActiveCol ? 'sheet__col--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={cellStyle(c)}
                    title={c.group || undefined}
                    aria-sort={
                      sortKey === c.key ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined
                    }
                  >
                    {c.isSelect ? (
                      <input
                        type="checkbox"
                        className="sheet__check"
                        aria-label="Pilih semua baris di halaman ini"
                        checked={rows.length > 0 && rows.every((r) => selectedKeys?.has(rowKey(r)))}
                        onChange={(e) => {
                          const next = new Set(selectedKeys ?? [])
                          if (e.target.checked) for (const r of rows) next.add(rowKey(r))
                          else for (const r of rows) next.delete(rowKey(r))
                          onSelectChange?.(next)
                        }}
                      />
                    ) : onSort && !c.isRownum ? (
                      <button
                        type="button"
                        className="sheet__sort"
                        onClick={() => onSort(c.key)}
                        aria-label={`Urutkan ${c.label}`}
                      >
                        {c.label}
                        <span aria-hidden="true" className="sheet__sort-mark">
                          {sortKey === c.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 12 }).map((_, i) => (
                <tr key={`sk-${i}`} className="sheet__skel">
                  <td colSpan={layout.all.length}>
                    <span className="sheet__skel-bar" style={{ width: `${88 - (i % 6) * 7}%` }} />
                  </td>
                </tr>
              ))}

            {!loading && padTop > 0 && (
              <tr aria-hidden="true" className="sheet__spacer">
                <td colSpan={layout.all.length} style={{ height: padTop }} />
              </tr>
            )}

            {!loading &&
              slice.map((row, i) => {
                const idx = start + i
                const rk = rowKey(row)
                const isFocused = idx === focusIdx
                const isFlash = flashKeys?.has(rk) ?? false
                // Band from the absolute data index so windowing cannot shift it.
                const banded = (rowNumberOffset + idx) % 2 === 1
                return (
                  <tr
                    key={rk}
                    className={[
                      banded ? 'sheet__row--band' : '',
                      isFocused ? 'sheet__row--on' : '',
                      isFlash ? 'sheet__row--flash' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ height: ROW_H }}
                    onClick={() => openRowDelayed(row, idx)}
                    tabIndex={-1}
                    aria-selected={isFocused || undefined}
                  >
                    {layout.all.map((c) => {
                      const col = c as SheetColumn<T>
                      const rawVal = c.isRownum
                        ? rowNumberOffset + idx + 1
                        : c.raw
                          ? c.raw(row)
                          : (row as Record<string, unknown>)[c.key]
                      const isEditing = editing?.row === rk && editing?.key === c.key
                      const isActive = activeCell?.row === rk && activeCell?.key === c.key
                      const editableCell = !!onCellCommit && !!col.editable && col.source !== 'audit'
                      const text = c.isRownum ? String(rawVal) : formatCell(col.type, rawVal)
                      const isPicked = selectedKeys?.has(rk) ?? false
                      return (
                        <td
                          key={c.key}
                          className={[
                            c.isRownum ? 'sheet__rownum' : '',
                            c.isSelect ? 'sheet__select' : '',
                            c.isFrozen && !c.isRownum ? 'sheet__frozen' : '',
                            !c.isRownum && !c.isSelect && (col.align === 'end' || isNumeric(col.type))
                              ? 'sheet__num'
                              : '',
                            editableCell ? 'is-editable' : '',
                            isEditing ? 'is-editing' : '',
                            isActive ? 'sheet__cell--active' : '',
                            isPicked ? 'is-picked' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={cellStyle(c)}
                          title={text || undefined}
                          onClick={(e) => {
                            if (c.isSelect) {
                              e.stopPropagation()
                              const next = new Set(selectedKeys ?? [])
                              if (next.has(rk)) next.delete(rk)
                              else next.add(rk)
                              onSelectChange?.(next)
                              return
                            }
                            if (!c.isRownum) {
                              e.stopPropagation()
                              setActiveCell({ row: rk, key: c.key })
                              openRowDelayed(row, idx)
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (!editableCell) return
                            e.stopPropagation()
                            cancelPendingOpen()
                            beginEdit(row, col)
                          }}
                        >
                          {c.isSelect ? (
                            <input
                              type="checkbox"
                              className="sheet__check"
                              aria-label={`Pilih baris ${rowNumberOffset + idx + 1}`}
                              checked={isPicked}
                              readOnly
                            />
                          ) : isEditing ? (
                            <input
                              // Autofocus is the point of the inline editor.
                              autoFocus
                              className="sheet__editor"
                              value={editValue}
                              inputMode={col.type === 'money' || col.type === 'int' ? 'decimal' : undefined}
                              type={col.type === 'date' ? 'date' : 'text'}
                              aria-label={`Ubah ${col.label}`}
                              onChange={(e) => setEditValue(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={() => void commitEdit(row, col)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void commitEdit(row, col)
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                                e.stopPropagation()
                              }}
                            />
                          ) : col.render ? (
                            col.render(row)
                          ) : (
                            text
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            {!loading && padBottom > 0 && (
              <tr aria-hidden="true" className="sheet__spacer">
                <td colSpan={layout.all.length} style={{ height: padBottom }} />
              </tr>
            )}
          </tbody>
        </table>

        {!loading && total === 0 && empty}
      </div>
    </div>
  )
}
