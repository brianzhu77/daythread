import { Button, Calendar, Popover, Tooltip } from '@heroui/react'
import { parseDate } from '@internationalized/date'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { LocalDate } from '../domain/types'
import { writtenDays } from '../domain/page-tree'
import { addDays, longLabel } from './dates'
import { useWorkspace } from './use-day'
import { ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon } from './icons'

/**
 * Day title that opens a date picker, and `Today ‹ ›` (date navigation rules R2, R3; Jazz's HeroUI note f853703).
 * Arrows move only up to today (R2); the title's picker opens any day, and a future one only as its preview.
 */
export function DayHeader({ date, today, firstDay = false }: { date: LocalDate; today: LocalDate; firstDay?: boolean }) {
  const navigate = useNavigate()
  const { workspace } = useWorkspace()
  // A dot under a day that has something written (or subpages): the sidebar Days rule, so browsing makes no dots.
  const written = workspace ? writtenDays(workspace) : new Set<string>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const isToday = date === today
  // A future page opened from the Calendar or a URL is also a stop: › never walks further ahead.
  const atLatest = date >= today
  const relative = relativeDay(date, today)
  const go = (target: LocalDate) => {
    if (target === today) void navigate({ to: '/' })
    else void navigate({ to: '/day/$date', params: { date: target } })
  }

  return (
    <header className="day-head">
      <h1 className="day-title">
        <Popover isOpen={pickerOpen} onOpenChange={setPickerOpen}>
          <Button variant="ghost" className="day-title-trigger" aria-label={`${relative ? `${relative}, ` : ''}${longLabel(date)}. Choose a date`}>
            {relative && <span className={`relative-day ${isToday ? 'is-today' : ''}`}>{relative}<span className="relative-day-comma">,</span> </span>}
            <span className="day-title-date">{longLabel(date)}</span>
            <ChevronDownIcon />
          </Button>
          <Popover.Content placement="bottom start">
            <Popover.Dialog aria-label="Choose a date">
              <Calendar
                className="day-picker"
                aria-label="Date"
                value={parseDate(date)}
                onChange={value => {
                  setPickerOpen(false)
                  // Brian f092ae63 / Lead d9b94b84: every day can be picked. A past day or today opens with a plain page
                  // (made on opening); a future day opens its preview, plan + "Create page", so looking creates nothing.
                  go(value.toString())
                }}
              >
                <Calendar.Header>
                  <Calendar.Heading />
                  <Calendar.NavButton slot="previous" />
                  <Calendar.NavButton slot="next" />
                </Calendar.Header>
                <Calendar.Grid>
                  <Calendar.GridHeader>{day => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                  <Calendar.GridBody>{day => (
                    <Calendar.Cell date={day} className={day.toString() > today ? 'is-future' : undefined}>
                      {({ formattedDate }) => <>{formattedDate}{written.has(day.toString()) && <Calendar.CellIndicator className="day-picker-dot" />}</>}
                    </Calendar.Cell>
                  )}</Calendar.GridBody>
                </Calendar.Grid>
              </Calendar>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </h1>
      <nav className="day-nav" aria-label="Change day">
        {/* Hidden rather than removed on today, so the arrows never shift between days. */}
        <Button variant="secondary" className={isToday ? 'invisible' : undefined} onPress={() => go(today)}>
          Today
        </Button>
        <Button variant="secondary" isIconOnly aria-label="Previous day" onPress={() => go(addDays(date, -1))}>
          <ArrowLeftIcon />
        </Button>
        {atLatest ? (
          // The tooltip trigger is the focusable control screen readers see; the disabled button inside is only visual.
          <Tooltip delay={0}>
            <Tooltip.Trigger aria-label="Next day" aria-disabled="true">
              {/* HeroUI's Button drops aria-hidden, so a wrapper hides it. */}
              <span aria-hidden="true" className="contents">
                <Button variant="secondary" isIconOnly isDisabled>
                  <ArrowRightIcon />
                </Button>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>Future days open from the Calendar</Tooltip.Content>
          </Tooltip>
        ) : (
          <Button variant="secondary" isIconOnly aria-label="Next day" onPress={() => go(addDays(date, 1))}>
            <ArrowRightIcon />
          </Button>
        )}
      </nav>
      {firstDay && <p className="day-first">A page for each day. Write anything; unfinished to-dos come along to tomorrow.</p>}
    </header>
  )
}

function relativeDay(date: LocalDate, today: LocalDate): string | null {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return null
}
