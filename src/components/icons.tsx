// Small stroke icons drawn for Daythread (craft-v1 §4: no Craft icon assets).
import type { ReactNode } from 'react'

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const TodayIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
  </Icon>
)

export const TasksIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="m8.5 12.2 2.4 2.4 4.8-5" />
  </Icon>
)

export const CalendarIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
    <path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" strokeWidth={2.4} />
  </Icon>
)

export const PagesIcon = () => (
  <Icon>
    <path d="M7 3.5h7l4.5 4.5v10.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
    <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5" />
  </Icon>
)

export const ReviewIcon = () => (
  <Icon>
    <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon size={24}>
    <path d="M12 5v14M5 12h14" strokeWidth={2} />
  </Icon>
)

export const SearchIcon = () => (
  <Icon size={18}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)

// Control icons. Text glyphs such as ⌄ or ← sit on the font baseline and drift off-centre; these don't.
export const ChevronDownIcon = () => (
  <Icon size={14}>
    <path d="m6 9 6 6 6-6" strokeWidth={2} />
  </Icon>
)

export const ChevronRightIcon = () => (
  <Icon size={14}>
    <path d="m9 6 6 6-6 6" strokeWidth={2} />
  </Icon>
)

export const ArrowLeftIcon = () => (
  <Icon size={18}>
    <path d="M19 12H5M11 6l-6 6 6 6" strokeWidth={2} />
  </Icon>
)

export const ArrowRightIcon = () => (
  <Icon size={18}>
    <path d="M5 12h14M13 6l6 6-6 6" strokeWidth={2} />
  </Icon>
)

export const CloseIcon = () => (
  <Icon size={16}>
    <path d="M6 6l12 12M18 6 6 18" strokeWidth={2} />
  </Icon>
)

export const UndoIcon = () => (
  <Icon size={20}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)

export const RedoIcon = () => (
  <Icon size={20}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
)

export const CheckboxIcon = () => (
  <Icon size={18}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
  </Icon>
)

// The six-dot grip (⠿) people know from Notion and Craft; three lines would read as a menu.
export const GripIcon = () => (
  <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor">
    {[2, 8, 14].flatMap(y => [<circle key={`l${y}`} cx="2" cy={y} r="1.5" />, <circle key={`r${y}`} cx="8" cy={y} r="1.5" />])}
  </svg>
)
