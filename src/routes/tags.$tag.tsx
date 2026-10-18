import { createFileRoute } from '@tanstack/react-router'
import { TagScreen } from '../components/tags-view'

export const Route = createFileRoute('/tags/$tag')({
  component: Tag,
})

function Tag() {
  const { tag } = Route.useParams()
  return <TagScreen key={tag} tagKey={tag} />
}
