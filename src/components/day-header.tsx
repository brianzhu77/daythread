import { Button, Calendar, Popover, Tooltip } from '@heroui/react'
import { parseDate } from '@internationalized/date'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { LocalDate } from '../domain/types'
import { addDays, longLabel } from './dates'
import { ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon } from './icons'

/**
 * Day title that opens a date picker, and `Today ‹ ›` (date navigation rules R2, R3; Jazz's HeroUI note f853703).
 * Arrows move only up to today (R2): future days open from the Calendar, so nothing here can create a future page.
 */
export function DayHeader({ date, today }: { date: LocalDate; today: LocalDate }) {
  const navigate = useNavigate()
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
                maxValue={parseDate(today)}
                onChange={value => {
                  setPickerOpen(false)
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
                  <Calendar.GridBody>{day => <Calendar.Cell date={day} />}</Calendar.GridBody>
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
    </header>
  )
}

function relativeDay(date: LocalDate, today: LocalDate): string | null {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return null
}
