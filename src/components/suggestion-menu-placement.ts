import { type Middleware, type Placement, offset, shift, size } from '@floating-ui/react'

// BlockNote's suggestion-menu placement (its suggestionMenuMiddleware.ts, which the package doesn't export), with one
// change: `bottomRoom` keeps a strip at the bottom of the screen free. With the phone keyboard up that strip holds
// the editor's toolbar, which BlockNote doesn't know about, so its menus ran under the toolbar and covered it (B4).
// With no strip (desktop, keyboard down) the menus sit exactly where BlockNote puts them.
const OFFSET = 10
const PADDING = 10
const MAX_HEIGHT = 600
const MIN_HEIGHT = 300

export function suggestionMenuMiddleware(bottomRoom: () => number): Middleware[] {
  const padding = () => ({ top: PADDING, right: PADDING, left: PADDING, bottom: PADDING + bottomRoom() })
  // Below the trigger, unless there is less than MIN_HEIGHT of room there and more room above.
  const placeBelowUnlessCramped: Middleware = {
    name: 'placeBelowUnlessCramped',
    async fn(state) {
      const { rects, placement, platform } = state
      const floating = { ...rects.floating, height: MIN_HEIGHT }
      const below = await platform.detectOverflow({ ...state, rects: { ...rects, floating }, y: rects.reference.y + rects.reference.height + OFFSET }, { padding: padding() })
      let wanted: Placement = 'bottom-start'
      if (below.bottom > 0) {
        const above = await platform.detectOverflow({ ...state, rects: { ...rects, floating }, y: rects.reference.y - OFFSET - MIN_HEIGHT }, { padding: padding() })
        if (above.top < below.bottom) wanted = 'top-start'
      }
      return wanted === placement ? {} : { reset: { placement: wanted } }
    },
  }
  return [
    placeBelowUnlessCramped,
    offset(OFFSET),
    shift(),
    // Options as a function, so the strip is read each time the menu is placed (the keyboard comes and goes).
    size(() => ({
      apply({ elements, availableHeight }) {
        elements.floating.style.maxHeight = `${Math.max(0, Math.min(availableHeight, MAX_HEIGHT))}px`
        // Keep the menu at the widest it has been since it opened, so it doesn't shrink and grow while filtering.
        const width = elements.floating.getBoundingClientRect().width
        if (width >= (parseFloat(elements.floating.style.minWidth) || 0) + 1) elements.floating.style.minWidth = `${Math.ceil(width)}px`
      },
      padding: padding(),
    })),
  ]
}
