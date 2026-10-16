import { createFileRoute } from '@tanstack/react-router'
import { getReadiness } from '../server/readiness'

export const Route = createFileRoute('/')({
  loader: () => getReadiness(),
  component: Scaffold,
})

const sections = ['TODO · Top 3', 'TODO · Other', 'Events', 'Good Stuffs', 'Notes']

function Scaffold() {
  const readiness = Route.useLoaderData()
  return (
    <main>
      <header><p className="eyebrow">Daythread</p><h1>Your day, in one place.</h1></header>
      <aside role="status">
        <strong>Local scaffold</strong>
        <p>The app server is running. Saving, AI and reminders are not connected yet.</p>
      </aside>
      <div className="sections" aria-label="Daily note section outline">
        {sections.map(title => <section key={title}><h2>{title}</h2><p>Section outline</p></section>)}
      </div>
      <footer>{readiness.application} · {readiness.phase} · external services {readiness.externalServices}</footer>
    </main>
  )
}
