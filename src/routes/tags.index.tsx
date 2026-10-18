import { createFileRoute } from '@tanstack/react-router'
import { TagsScreen } from '../components/tags-view'

export const Route = createFileRoute('/tags/')({
  component: TagsScreen,
})
