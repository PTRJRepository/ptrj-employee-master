/**
 * CardGrid.tsx — the same data as <Sheet>, as a wall of cards.
 *
 * A spreadsheet is the right tool for comparing one column across hundred rows;
 * it is the wrong tool for reading one employee. Card view keeps every field
 * reachable without a horizontal scroll and makes the record itself the object
 * of the screen, which is how you actually review a person.
 *
 * The two views share one row model, one selection set and one edit handler, so
 * switching between them never loses state.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface CardField {
  key: string
  label: string
  /** Preformatted display string. Empty means the field is omitted. */
  value: string
  /** Optional badge treatment for status-like values. */
  tone?: 'plain' | 'accent' | 'muted' | 'warn' | 'danger'
  /** Marks a money/quantity field for tabular figures. */
  numeric?: boolean
  /** Hidden until the card is expanded. */
  detail?: boolean
}

export interface CardGridProps<T> {
  rows: T[]
  rowKey: (row: T) => string | number
  /** Identity block: the title, an optional subtitle, and a monogram seed. */
  title: (row: T) => string
  subtitle?: (row: T) => string | null
  /** Fields for the card body; `detail: true` ones show on expand only, at ≥8 fields. */
  fields: (row: T) => CardField[]
  /** Rendered in the card footer as actions. */
  actions?: (row: T) => ReactNode
  onOpen?: (row: T) => void
  loading?: boolean
  empty?: ReactNode
  /** Grid of cards scrolls inside this height. */
  height?: string
  selectable?: boolean
  selectedKeys?: ReadonlySet<string | number>
  onSelectChange?: (keys: Set<string | number>) => void
  flashKeys?: ReadonlySet<string | number>
}

/**
 * Initials from a person name: "Ahmad Subandi" -> "AS".
 *
 * Employee names in this data carry a trailing row number ("Ahmad Subandi 0001"),
 * so a naive first+last initial yields "A0" for every single card. Only
 * alphabetic tokens may contribute initials.
 */
function monogram(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** A short deterministic hue offset so a wall of cards is scannable. */
function hueFor(seed: string | number): number {
  const s = String(seed)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export default function CardGrid<T extends object>({
  rows,
  rowKey,
  title,
  subtitle,
  fields,
  actions,
  onOpen,
  loading = false,
  empty,
  height = 'calc(100dvh - 16rem)',
  selectable = false,
  selectedKeys,
  onSelectChange,
  flashKeys,
}: CardGridProps<T>) {
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Cap the wall so a 250-row page cannot build 250 subtrees in one commit;
  // the count is surfaced in the footer so the trim is never silent.
  const CAP = 60
  const shown = rows.slice(0, CAP)
  const trimmed = rows.length - shown.length

  useEffect(() => {
    // Replacing the rows (filter change, refresh) must not leave stale expansions.
    setExpanded((prev) => {
      if (!prev.size) return prev
      const live = new Set(rows.map(rowKey))
      const next = new Set([...prev].filter((k) => live.has(k)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const toggleExpand = (k: string | number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const togglePick = (k: string | number) => {
    const next = new Set(selectedKeys ?? [])
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onSelectChange?.(next)
  }

  return (
    <div className="cards" ref={scrollRef} style={{ height }}>
      {loading && (
        <div className="cards__grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="card card--skel" key={`cs-${i}`}>
              <span className="sheet__skel-bar" style={{ width: '60%' }} />
              <span className="sheet__skel-bar" style={{ width: '90%' }} />
              <span className="sheet__skel-bar" style={{ width: '75%' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && empty}

      {!loading && rows.length > 0 && (
        <>
          <div className="cards__grid">
            {shown.map((row) => {
              const k = rowKey(row)
              const all = fields(row)
              const main = all.filter((f) => !f.detail)
              const extra = all.filter((f) => f.detail)
              const isOpen = expanded.has(k)
              const isPicked = selectedKeys?.has(k) ?? false
              const isFlash = flashKeys?.has(k) ?? false
              const name = title(row)
              const sub = subtitle?.(row)
              const hue = hueFor(name)
              return (
                <article
                  key={k}
                  className={['card', isPicked ? 'is-picked' : '', isFlash ? 'is-flash' : '']
                    .filter(Boolean)
                    .join(' ')}
                  style={{ '--card-hue': hue } as React.CSSProperties}
                >
                  <header className="card__head">
                    {selectable && (
                      <input
                        type="checkbox"
                        className="sheet__check"
                        aria-label={`Pilih ${name}`}
                        checked={isPicked}
                        onChange={() => togglePick(k)}
                      />
                    )}
                    <span className="card__mono" aria-hidden="true">
                      {monogram(name)}
                    </span>
                    <span className="card__id">
                      <span className="card__name">{name}</span>
                      {sub && <span className="card__sub">{sub}</span>}
                    </span>
                  </header>

                  <dl className="card__body">
                    {main.map((f) => (
                      <div className="card__row" key={f.key}>
                        <dt>{f.label}</dt>
                        <dd
                          className={f.numeric ? 'tnum' : undefined}
                          title={f.value}
                        >
                          {f.tone && f.tone !== 'plain' ? (
                            <span className={`tag tag--${f.tone}`}>{f.value}</span>
                          ) : (
                            f.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {isOpen && extra.length > 0 && (
                    <dl className="card__body card__body--extra">
                      {extra.map((f) => (
                        <div className="card__row" key={f.key}>
                          <dt>{f.label}</dt>
                          <dd className={f.numeric ? 'tnum' : undefined} title={f.value}>
                            {f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <footer className="card__foot">
                    {onOpen && (
                      <button type="button" className="card__act" onClick={() => onOpen(row)}>
                        Detail
                      </button>
                    )}
                    {extra.length > 0 && (
                      <button
                        type="button"
                        className="card__act"
                        aria-expanded={isOpen}
                        onClick={() => toggleExpand(k)}
                      >
                        {isOpen ? 'Ringkas' : `+${extra.length} lagi`}
                      </button>
                    )}
                    {actions?.(row)}
                  </footer>
                </article>
              )
            })}
          </div>

          {trimmed > 0 && (
            <p className="cards__more">
              Menampilkan {shown.length} dari {rows.length} kartu. Persempit filter, atau buka
              tampilan Tabel untuk melihat semuanya sekaligus.
            </p>
          )}
        </>
      )}
    </div>
  )
}
