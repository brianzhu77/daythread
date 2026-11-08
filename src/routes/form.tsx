import { createFileRoute } from '@tanstack/react-router'
import { FormPage } from '../components/form-page'

/** A form to answer (forms.md §4): its database and view; `preview` sends nothing. */
export interface FormSearch { db?: string; view?: string; preview?: 1 }
export const Route = createFileRoute('/form')({
  validateSearch: (search: Record<string, unknown>): FormSearch => ({
    ...(typeof search.db === 'string' && search.db ? { db: search.db } : {}),
    ...(typeof search.view === 'string' && search.view ? { view: search.view } : {}),
    ...(search.preview === 1 || search.preview === '1' ? { preview: 1 as const } : {}),
  }),
  component: Form,
})

function Form() {
  const { db, view, preview } = Route.useSearch()
  return <FormPage databaseId={db ?? ''} viewId={view ?? ''} preview={Boolean(preview)} />
}
