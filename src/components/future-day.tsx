import { AlertDialog, Button, Popover } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import type { LocalDate, Task } from '../domain/types'
import { DateTag } from './date-tag'
import { longLabel } from './dates'
import { useWorkspace } from './use-day'

// Date navigation rules R4, R5, R7: looking at a future day never creates its page; only Create page does.

/** Creates the day's page once; the button stays disabled while the command is in flight. */
function useCreateDay(date: LocalDate) {
  const { run } = useWorkspace()
  const [pending, setPending] = useState(false)
  const create = async () => {
    if (pending) return null
    setPending(true)
    try {
      return await run({ type: 'ensure-day', date })
    } finally {
      setPending(false)
    }
  }
  return { create, pending }
}

function usePhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

const promptBody = 'Create its page now to plan ahead? It starts from your day template.'

/**
 * Calendar trigger for a future day without a page (R4): a Popover on desktop, an AlertDialog on phone.
 * Cancel writes nothing (R6); Create page creates it and opens it (R5).
 */
export function FutureDayPrompt({ date, children }: { date: LocalDate; children: ReactNode }) {
  const navigate = useNavigate()
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const { create, pending } = useCreateDay(date)
  const heading = `${longLabel(date)} hasn't happened yet`
  const confirm = async () => {
    if (!(await create())) return
    setOpen(false)
    void navigate({ to: '/day/$date', params: { date } })
  }
  const trigger = (
    <Button variant="ghost" className="future-day-trigger">
      {children}
    </Button>
  )
  const actions = (
    <>
      <Button variant="tertiary" onPress={() => setOpen(false)}>
        Cancel
      </Button>
      <Button variant="primary" isDisabled={pending} onPress={() => void confirm()}>
        Create page
      </Button>
    </>
  )

  if (phone)
    return (
      <AlertDialog isOpen={open} onOpenChange={setOpen}>
        {trigger}
        <AlertDialog.Backdrop isDismissable>
          <AlertDialog.Container placement="bottom">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>{heading}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>{promptBody}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>{actions}</AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    )

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      {trigger}
      <Popover.Content placement="bottom start" className="future-day-popover">
        <Popover.Dialog aria-label={heading}>
          <Popover.Heading>{heading}</Popover.Heading>
          <p>{promptBody}</p>
          <div className="future-day-actions">{actions}</div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

/** A future day opened by URL with no page yet (R7): no automatic creation, Create page plus what is planned. */
export function FutureDayState({ date, today, planned }: { date: LocalDate; today: LocalDate; planned: Task[] }) {
  const { create, pending } = useCreateDay(date)
  return (
    <section className="future-day-state" aria-labelledby="future-day-heading">
      <h2 id="future-day-heading">{longLabel(date)} hasn't happened yet</h2>
      <p>There's no page for this day. You can start one now if you want to plan ahead.</p>
      <Button variant="primary" isDisabled={pending} onPress={() => void create()}>
        Create page
      </Button>
      {planned.length > 0 && (
        <div className="future-day-planned">
          <h3>Planned or due this day</h3>
          <ul className="plain task-list">
            {planned.map(t => (
              <li key={t.id} className="calendar-task">
                <span className="check-mark" aria-hidden="true" />
                <span className="task-title">{t.title}</span>
                <DateTag task={t} today={today} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
