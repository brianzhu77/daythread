import { createFileRoute } from '@tanstack/react-router'
import { PagesScreen } from '../components/pages-screen'

export const Route = createFileRoute('/pages')({
  component: PagesScreen,
})
