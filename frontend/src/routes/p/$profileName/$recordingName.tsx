import { createFileRoute } from '@tanstack/react-router'
import { RecordingPage } from '../../../components/RecordingPage'

export const Route = createFileRoute('/p/$profileName/$recordingName')({
  component: RecordingPage,
})