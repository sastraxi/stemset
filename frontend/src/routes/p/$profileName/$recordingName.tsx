import { createFileRoute } from '@tanstack/react-router'
import { RecordingPage } from '../../../components/RecordingPage'
import { updateRecordingState } from '../../../lib/storage'

export const Route = createFileRoute('/p/$profileName/$recordingName')({
  component: RecordingPage,
  validateSearch: (search) => {
    return {
      t: typeof search.t === 'number' ? search.t : undefined,
      source: typeof search.source === 'string' ? search.source : undefined,
    } as { t?: number; source?: string }
  },
  beforeLoad: ({ params, search }) => {
    // If there's a time parameter in the URL, update localStorage before rendering
    if (search.t !== undefined) {
      updateRecordingState(params.profileName, params.recordingName, {
        playbackPosition: search.t
      });
    }
  },
})