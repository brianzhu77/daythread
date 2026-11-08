---
name: Daythread
description: Ink on white. One neutral scale, one blue for the few, hairlines instead of fills.
colors:
  paper: "#ffffff"
  paper-tint: "#f9f9f9"
  paper-fill: "#f0f0f0"
  paper-fill-hover: "#e8e8e8"
  hairline: "#e0e0e0"
  border-subtle: "#d9d9d9"
  border-control: "#cecece"
  placeholder: "#bbbbbb"
  ink-faint: "#8d8d8d"
  ink-faint-hover: "#838383"
  ink-soft: "#646464"
  ink: "#202020"
  thread-blue: "#0090ff"
  thread-blue-pressed: "#0588f0"
  thread-blue-text: "#0d74ce"
  thread-blue-wash: "#e6f4fe"
  deadline-red: "#e5484d"
  notice-amber: "#a8551b"
  notice-amber-wash: "#fdf2e7"
  glass: "rgba(255, 255, 255, .86)"
  scrim: "rgba(20, 20, 30, .18)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "34px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  row:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.3
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.05em"
rounded:
  tight: "4px"
  badge: "6px"
  control: "8px"
  block: "12px"
  card: "16px"
  sheet: "24px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  screen: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-tint}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.paper-fill}"
    textColor: "{colors.ink-soft}"
  filter-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "40px"
  filter-chip-selected:
    backgroundColor: "{colors.paper-fill}"
    textColor: "{colors.ink}"
  badge:
    backgroundColor: "{colors.paper-fill}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.badge}"
    padding: "1px 7px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "48px"
  nav-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "30px"
  nav-row-active:
    backgroundColor: "{colors.paper-fill}"
    textColor: "{colors.ink}"
  block:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "14px 16px"
  tab-active:
    backgroundColor: "{colors.paper-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
---

# Design System: Daythread

## Overview

**Creative North Star: "Ink on White"**

Daythread is a document before it is an interface. Every screen is a sheet of white paper; the words on it are the
user's own, and everything the app adds is set in grey so that it reads as margin notes, not as chrome. Hierarchy comes
from type weight and from which step of one neutral scale a thing is drawn in, never from a fill or a second colour.
Edges are hairlines. Where a resting surface in most apps would be tinted, here it stays white and gets a 1 px line.

The system is quiet and precise. Quiet: nothing asks for attention unless it is the user's data or a warning that
something is about to be lost; a selected tab, filter or sidebar row is a slightly darker grey, not a coloured block.
Precise: rows align to the pixel across every row type on the page, markers centre on the first text line, and a
geometry gate measures this at 390 and 1280 before a change is shown to anyone. The one colour, blue, is spent where
attention is at this instant: the focus ring, the checked box, the text selection, the editor's chips, and the word
Today. The mark tells the same story: three grey dots on a line, today the only one filled.

Controls are flat and typographic. A button is text in a bordered rounded rectangle; the primary action is the darkest
grey with white text, and links are grey and underlined. Hover moves one step along the scale. Depth exists only for
layers that genuinely float above the page.

**Key Characteristics:**
- One white surface for every screen, including the sidebar; the first version's tinted grouped background is gone.
- One 12-step neutral scale, Paper to Ink, carrying text, icons, borders, fills and every state.
- Blue on a closed list of five uses; the primary button and links are grey.
- 8 px rounded rectangles with a 1 px border for controls; pills only on small badges and the phone's tab capsule.
- Hairlines separate; fills never do. Shadows appear only under floating layers.
- System type stack, 17 px body, hierarchy by weight and grey step.
- Dark mode is the same twelve steps restated; no rule is special-cased per scheme.

## Colors

A single neutral scale on white, with one blue held back for the five places attention lives right now.

### Primary
- **Thread Blue** (`thread-blue`): the filled dot of the mark and the app's only accent. Used as the 2 px focus ring,
  the fill of a checked box, the dot on a written day in the date picker, and the drop line while dragging.
- **Thread Blue, pressed** (`thread-blue-pressed`): the solid blue when hovered or pressed.
- **Thread Blue, text** (`thread-blue-text`): the word "Today" in the calendar and sidebar, and the text colour on a
  blue wash.
- **Thread Blue, wash** (`thread-blue-wash`): text selection, the `/` and `@` chips in the editor, and the flash on a
  line that just moved. Always paired with Thread Blue text.

### Neutral
The scale is Radix's neutral grey, one role per step, so a token's position says what it is for. Steps 1 to 5 are
backgrounds and the hairline; 6 to 8 are borders and placeholder; 9 to 12 are solids and text.

- **Paper** (`paper`): the surface. Pages, the sidebar, cards and blocks are all this white.
- **Paper, tint** (`paper-tint`): the subtlest background: a hovered row, a quiet block, a secondary button's hover.
- **Paper, fill** (`paper-fill`): element background: badges, the selected sidebar row, the selected filter chip, the
  current tab, a pressed style button, a ghost button's hover.
- **Paper, fill hover** (`paper-fill-hover`): an element background while hovered; also the soft line above grouped
  rows.
- **Hairline** (`hairline`): the one separator. The sidebar's right edge, the line under a title block, the border of
  a block that needs an edge, the rule between list rows, and a pressed element background.
- **Border, subtle** (`border-subtle`): the quieter control border: filter chips at rest, the day's arrows and Today,
  keyboard-shortcut boxes, the toggle's off track.
- **Border, control** (`border-control`): inputs, secondary buttons, the unchecked checkbox, and the selected chip's
  border.
- **Placeholder** (`placeholder`): placeholder text in a field or an empty line; the strong border.
- **Ink, faint** (`ink-faint`): tertiary text and icons: a weekday, a tree date, a done task's title, the chevron.
- **Ink, faint hover** (`ink-faint-hover`): a solid grey while hovered.
- **Ink, soft** (`ink-soft`): secondary text, labels, section captions, links, sidebar rows at rest, badge text, the
  tag colour. The primary button's hover.
- **Ink** (`ink`): body, titles, icons that matter, the primary button's fill, and the selected state's text.

### Status
- **Deadline Red** (`deadline-red`): a passed deadline and a destructive action. The only other hue in the product.
- **Notice Amber** (`notice-amber`, on `notice-amber-wash`): the rare notice: a receipt waiting for confirmation, a
  budget line. Never decoration.

### Overlays
- **Glass** (`glass`): the phone's floating tab capsule, the `+` circle and the laptop's floating capture bar, with a
  20 px backdrop blur.
- **Scrim** (`scrim`): behind a sheet.

### Dark
Dark follows the system setting; there is no switch. The twelve grey and twelve blue steps are restated under
`prefers-color-scheme: dark` with Radix's dark values (Paper `#111111` to Ink `#eeeeee`; Thread Blue stays
`#0090ff`, its text step becomes `#70b8ff`, its wash `#0d2847`), so everything that names a step follows. Only the
colours off the scales are restated: red `#ff6369`, amber, the toast, the glass, the scrim, the hover dim and the
shadows, which gain weight because a shadow on near-black needs more to read. The primary button is Ink on Paper in
both schemes, so it is white on dark. A rule that needs a scheme-specific value is a sign the token is wrong.

### Named Rules
**The One Blue Rule.** Blue appears in exactly five places: the focus ring, the checked box, text selection and the
editor's chips, the word Today, and the written-day dot. Anything not on that list is grey, including the primary
button, links, the selected tab, the selected filter and the sidebar's active row.

**The Grey Auth Rule.** The sign-in, sign-up, forgot and reset screens have no primary among many, so they have no
blue at all: the button is Ink with Paper text, links are Ink-soft underlined, and the focus ring is Ink.

**The Step Rule.** A component names a step or an alias onto a step, never a raw value. Hover and pressed states move
one or two steps along the scale in the same direction; they never change hue.

## Typography

**Display Font:** none. Headlines use the body face at weight 700.
**Body Font:** the system stack: -apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Segoe UI, system-ui,
sans-serif.
**Label/Mono Font:** none distinct. Keyboard shortcuts are the body face at caption size in a bordered box.

**Character:** the platform's own face, set generously at 17 px with a 1.55 line height, so the user's writing in
English and Chinese reads as it would in Notes or Craft. The interface never has a voice of its own in type; it has
weight and grey.

### Hierarchy
- **Headline** (700, 28px, 34px, −0.02em): the day title ("Saturday, Nov 8"), the title of Pages, Tasks and the
  Calendar, the sign-in title. One per screen.
- **Title** (600, 20px, 1.35): list headers and the Calendar's day headers.
- **Section** (600, 19px, 1.35, 0em): the headings on a day page (TODO, Events, Good Stuffs, Notes) and review groups.
- **Body** (400, 17px, 1.55): every line the user writes, card titles, task titles on the morning card, field text.
  The reading column is 700 px, about 70 characters.
- **Row** (400, 16px, 24px): rows inside the editor, page-card titles, property fields; the fixed line height keeps a
  row level with its icon.
- **UI** (500, 15px): buttons, filter chips, sidebar rows, menu items, the sign-in subtitle.
- **Small** (400, 14px): the small sidebar rows, editor bar buttons, form labels.
- **Meta** (500, 13px, 20px): badges, date chips, save state, hints, card metadata, the sub-task's "↳ parent",
  the sidebar's group labels and its shortcut word.
- **Caption** (600, 12px, 0.05em): menu group titles (uppercase), the `/` menu's group labels (there at weight 400,
  sentence case) and shortcut hints.

### Named Rules
**The Weight Carries Rule.** A heading differs from a line by weight and size, not by colour: titles and body are Ink,
secondary text is Ink-soft, tertiary is Ink-faint. Nothing is emphasised by being blue.

**The Quiet Copy Rule.** On-screen text states the user's data or state, or warns before something is lost. A line
that explains how the app works is left out; menus show titles only. A new grey "explains why" line needs a reason.

## Layout

One surface. Every screen, including the sidebar, is a page on white; the only edge between the sidebar and the page
is a 1 px hairline. Content sits in a single reading column of 700 px (`--column`) with 20 px side gutters, centred
in the space to the right of the sidebar on a laptop and full width on a phone. Database pages may widen to 1100 px.

**Two layouts, one breakpoint.** Below 900 px the sidebar is hidden and navigation is a floating glass tab capsule at
the bottom, 16 px from each side and 12 px plus the safe area from the bottom, with a 60 px `+` circle beside it; text
scrolling under the bar fades over 48 px so nothing shows through the glass. From 900 px the sidebar is a sticky
260 px column with 18 px by 10 px padding, screens gain 48 px of top padding (24 px on the phone), and the capture bar
floats as a glass card under the title. Secondary breakpoints at 700 px (editor gutters, sheet becomes a centred
560 px dialog with 20 px corners above it), 600 px (hide the day's first arrow, sign-in top padding) and 430 px (filter
chips tighten so four fit a 375 px phone).

**Rhythm.** Sidebar rows are 30 px tall with a 1 px gap; group labels take 22 px above and 4 px below. The title block
keeps the day page's rhythm: 12 px under the title, 20 px before the first block. List sections open with 18 px;
cards use 12 px internal gaps and 16 px by 18 px padding; blocks 14 px by 16 px. Menus have 6 px padding with 38 px
rows. Spacing values are multiples of 2 px from a small set (2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 48).

**Touch.** Every tap target is at least 44 px (`--tap`) on the phone, including buttons that look smaller: the ⋯ on
a row is a 44 px target sitting on the title's first line. Row actions that reveal on hover with a fine pointer stay
visible on touch. The `/` menu's rows grow from 34 px to 44 px on a phone and drop their shortcut hints.

**Geometry gate.** Before a visual change is shown, every row type on the day page is measured at 1280 and 390 on a
copy of real data: each row's text starts within 1 px of its column, and its marker centres on the first text line
within 1 px. Nested bullets match the top-level dot's size and gap within 1 px. Small status marks reach 3:1 against
their own cell's fill.

## Elevation & Depth

Flat by default. A surface at rest casts no shadow and has no fill; its edge, when it needs one, is a 1 px hairline
drawn as an inset ring, so the box never grows. Depth is reserved for layers that genuinely float above the page, and
a shadow is therefore a statement: this is above what you were reading.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 2px 6px rgba(0, 0, 0, .06), 0 10px 30px rgba(0, 0, 0, .10)`): menus, the `/` menu, the
  sheet, the phone's tab capsule and `+`, the laptop's floating capture bar, the editor's selection bar, a dialog.
  In dark: `0 2px 6px rgba(0, 0, 0, .35), 0 10px 30px rgba(0, 0, 0, .5)`.
- **Row** (`box-shadow: 0 1px 2px rgba(0, 0, 0, .08)`): a row lifted while dragging. Dark `0 1px 2px rgba(0, 0, 0, .4)`.
- **Card, soft** (`box-shadow: 0 1px 2px rgba(17, 17, 26, .04)`): a saved link card and a receipt, the one resting
  element with a whisper of lift because it represents something brought in from outside the page.
- **Fab** (`box-shadow: 0 5px 24px #0002`): the desktop capture `+`.

### Named Rules
**The Floating Rule.** A shadow means the layer is above the page. Nothing at rest casts one; a menu, sheet, capsule
or dialog always does.

**The Hairline Rule.** An edge is a 1 px line in Hairline grey, not a tinted background. A block on a page, an empty
state, a note card and the sidebar's edge all get the line; none gets a fill.

## Shapes

Rounded rectangles, not pills. Every control, button, input and chip is an 8 px rounded rectangle (`control`) with a
1 px border or inset ring; the ring is `box-shadow: inset 0 0 0 1px` so a hover that darkens the border never moves
the layout. Rows in the sidebar, menus and the editor share the 8 px corner. Containers step up: 12 px (`block`) for
a block on a page, a menu, a note card or a dialog; 16 px (`card`) for the morning card and other things the app
brings; 24 px (`sheet`) on the top corners of a phone sheet, 20 px when it becomes a centred dialog. Small marks step
down: 6 px (`badge`) for tags and date chips, 4 px (`tight`) for shortcut boxes and link buttons, 5 px for the 20 px
checkbox with a 1.5 px border, 3 px for the 36 by 5 px sheet handle.

Pills (`pill`) survive in exactly two places: the phone's floating tab capsule and its 48 px tabs, and the small
inline reference chip. Circles are for the `+` buttons and spinners. Borders are always 1 px (1.5 px on the checkbox
and the sign-in field's focus ring) and never dashed. Icons are the app's own 24-grid stroke set at 18 to 22 px,
drawn in the current text colour at 1.75 px.

### Named Rules
**The Rounded-Rectangle Rule.** A control is an 8 px rounded rectangle with a 1 px edge. A fully rounded control is
a tab in the phone's capsule or nothing.

## Components

### Buttons
Text in a bordered rounded rectangle; the words do the work, the shape only holds them.
- **Shape:** 8 px rounded rectangle, 44 px tall (48 px on the auth screens), 0 by 14 px padding, 1 px border, UI
  type at weight 500 to 600, no text transform.
- **Primary:** Ink fill with Paper text at weight 600 (Done, Sign in, Plan for today, Create page). The darkest grey,
  never blue; white on dark.
- **Secondary:** Paper fill, Border-control edge, Ink text at weight 500 (Today, Not today, Restore, Add, the day's
  arrows).
- **Ghost:** no border, Ink-soft text (arrows, ⋯, Later); icon-only ghosts are 44 px squares.
- **Link button:** no box; Ink-soft text underlined in Border-control, offset 3 px, Ink on hover. Links in a note
  look the same.
- **Hover:** Primary to Ink-soft; Secondary to Paper-tint; Ghost gains a Paper-fill background. Transitions 120 ms
  on background, colour and opacity.
- **Focus:** 2 px Thread Blue outline, 2 px offset. Ink on the auth screens.
- **Disabled:** 40 % opacity, default cursor. A disabled future-day arrow carries a tooltip on hover only.
- **Danger:** Deadline Red text on a ghost; confirmation dialogs set the primary in Ink.

### Chips
- **Filter chip** (Tasks' lists, the Calendar's Earlier / Later): Paper, 1 px Border-subtle ring, Ink-soft text at
  UI size, 40 px tall, 8 px corners. Selected: Paper-fill, Border-control ring, Ink at weight 600. Four fit a 375 px
  phone uncut; the row scrolls on narrower screens.
- **Badge** (a tag, a date chip, a Draft-like state): Paper-fill, Ink-soft text at Meta size with a 20 px line,
  1 by 7 px padding, 6 px corners. A date chip leads with a 12 px clock drawn in the text colour. A passed deadline
  turns the text Deadline Red on the same fill; a paused task's badge drops the fill for a 1 px Ink-faint ring.
- **Editor chips** (`/`, `@`, `[[`): Thread Blue wash with Thread Blue text, the one blue element inside a line.

### Cards / Containers
- **Block on a page** (Start the day, Due soon, the Calendar's note, an empty state, a note card): Paper, 1 px Hairline
  inset ring, 12 px corners, 14 by 16 px padding; no fill, no shadow.
- **Card the app brings** (the morning card): Paper, 1 px Hairline ring, 16 px corners, 16 by 18 px padding, 12 px
  internal gap, a Body-size head at weight 600 with −0.01em tracking and Meta-size metadata in Ink-soft.
- **Link card** (saved material, a receipt): Paper, 1 px Hairline border, 12 px corners, the soft card shadow, a 30 px
  square leading glyph.
- **Empty state:** the block's shape with 28 by 20 px padding, centred Ink-soft text, one noun phrase ("No pages yet").

### Inputs / Fields
- **Style:** Paper, 1 px Border-control inset ring, 8 px corners, 48 px tall, 0 by 14 px padding, Body type; the
  placeholder in Placeholder grey.
- **Hover:** ring steps to Placeholder grey.
- **Focus:** 2 px Thread Blue outline at 2 px offset on app fields; on the auth screens the ring itself thickens to
  1.5 px Ink with no outline.
- **In the editor:** lines have no box at all; a task title is a borderless textarea with 9 px vertical padding that
  sizes to its content. Error, offline and "Not saved" states are a Meta-size line in Ink-soft or Deadline Red
  beside the content, never a red border.
- **Checkbox (signature):** 20 px, 1.5 px Border-control edge, 5 px corners, Paper fill; hover edges in Thread Blue;
  checked fills Thread Blue with a white tick that scales in over 120 ms. A done title turns Ink-faint with a
  line-through in Border-control.

### Navigation
- **Sidebar (≥ 900 px):** sticky, 260 px, Paper with a 1 px Hairline right edge, 12 px padding, UI type. One row
  geometry for everything in it (Nov 8): 30 px tall, 0 by 8 px padding, 8 px corners, a 16 px icon in
  Ink-soft, 10 px to the words in Ink. Hover is Paper-tint; the current row Paper-fill with Ink at weight 500 and its
  icon in Ink. Rows sit 1 px apart. The lockup (mark, 8 px, wordmark at UI size) heads the column in the same
  geometry, one row tall with 12 px below. Group labels are Meta size, weight 500, sentence case, Ink-soft, with
  22 px above and 4 px below; a group's `+` is a 22 px ghost square at the label's right. The Search row ends in its
  shortcut as a quiet Meta-size word, not a box. The Pages tree shares the row geometry; a page's icon sits in the
  icon column and swaps to the chevron while its row is hovered or focused, so every title starts in one place; a
  child indents 16 px. The footer is pinned to the bottom of the sidebar's own scroll: the Trash row with its count
  at the right while it holds something, then the account row (the address, or "Account", with a 14 px chevron),
  which opens a menu upward holding Templates, Export, reminders, the time zone and week start as rows with a value
  at the right, Sign out and Delete account.
- **Tab capsule (< 900 px):** a floating glass pill, 6 px padding, saturate 1.6 and 20 px blur, the Float shadow;
  five 48 px tabs at most 64 px wide, Ink icons, the current tab a Paper-fill pill with Ink. A 60 px glass `+`
  circle sits beside it. The whole bar hides while the keyboard is up.
- **Sheet:** slides up 24 px over 200 ms (none under reduced motion) onto a Scrim; Paper, 24 px top corners, 8 by
  16 px padding plus the safe area, a 36 by 5 px handle in Border-control, 85 vh max. Above 700 px it becomes a
  centred 560 px dialog with 20 px corners.
- **Menus:** Paper, 1 px Hairline border, 12 px corners, Float shadow, 6 px padding, 38 px rows with 8 px corners,
  Paper-tint hover; groups separated by a hairline with 4 px above and below; group titles in Caption, uppercase,
  0.07em.

### The Mark (signature)
Three days, one thread: two outlined Ink dots at the ends of a line broken into two segments, today a filled Thread
Blue dot at the centre, on a 48 px grid with 3 px strokes (5 px below 24 px). The strokes take the current text
colour, so it follows dark mode and sits on anything. Clear space of one dot's width; never recoloured, never a
letterform. Wordmark: Daythread, one capital, title weight, −1 % tracking.

## Do's and Don'ts

### Do:
- **Do** name a token for every colour, size and radius; a raw hex, px font size or radius in a component rule is a
  review finding.
- **Do** give an element an edge with a 1 px Hairline inset ring when it needs one, and leave the surface white.
- **Do** keep blue to the five listed uses, and make every selected state a one-step-darker grey.
- **Do** keep every tap target at 44 px on the phone and keep row actions visible on touch.
- **Do** run the geometry gate at 1280 and 390 before showing a visual change, and honour reduced motion on every
  animation.
- **Do** restate a new colour in the dark block only when it is off the two scales; otherwise name a step.

### Don't:
- **Don't** make a control a pill. Fully rounded shapes belong to the phone's tab capsule and small badges only;
  buttons, inputs and filters are 8 px rounded rectangles.
- **Don't** introduce a second accent. No teal, green or violet in the product UI; red is for a passed deadline or a
  destructive action and nothing else.
- **Don't** add text that explains how the app works. Helper lines, placeholder tutorials and second lines in menus
  are left out; text states data or state, or warns before a loss.
- **Don't** fill a resting surface or cast a shadow under one; depth is for menus, sheets, capsules and dialogs.
- **Don't** colour the primary button or links blue, on any screen.
