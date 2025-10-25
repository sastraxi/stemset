import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '../../../components/ProfilePage'

export const Route = createFileRoute('/p/$profileName/')({
  component: ProfilePage,
})