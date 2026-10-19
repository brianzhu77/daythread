import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

/**
 * The ⋯ menu every row has (01 §1): a tap path for every action, no hover or right-click.
 * Items can be grouped; a group label renders as a small heading.
 */
/** `trigger` replaces the ⋯ button's content (e.g. a chip that opens its own menu); `triggerClass` its class. */
export function RowMenu({ label, groups, trigger, triggerClass = 'icon' }: { label: string; groups: { title?: string; items: MenuItem[] }[]; trigger?: ReactNode; triggerClass?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className={triggerClass}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
      >
        {trigger ?? '⋯'}
      </button>
      {open && (
        <div className="app-menu" role="menu" id={id}>
          {groups.map((g, gi) => (
            <div key={gi} className="menu-group" role="group" aria-label={g.title}>
              {g.title && <p className="menu-title">{g.title}</p>}
              {g.items.map(item => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? 'danger' : undefined}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="app-disclosure" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
