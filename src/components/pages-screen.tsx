import { Link } from '@tanstack/react-router'
import { PagesIcon } from './icons'

/** Pages tab placeholder (craft-v1 §5.6). The page tree arrives with the v0.4 page model; no fake tree here. */
export function PagesScreen() {
  return (
    <div className="list-screen">
      <h1 className="large-title">Pages</h1>
      <div className="empty-box tall">
        <PagesIcon />
        <p>Nested pages aren’t built yet. They come with the v0.4 page model.</p>
        <p>
          Daily pages are in <Link to="/calendar">Calendar</Link>.
        </p>
      </div>
    </div>
  )
}
