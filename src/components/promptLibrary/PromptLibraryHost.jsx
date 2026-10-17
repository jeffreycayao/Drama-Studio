import usePromptLibraryStore from '../../stores/promptLibraryStore'
import PromptLibraryDialog from './PromptLibraryDialog'

/** App-wide mount point: the library opens over any tab. */
export default function PromptLibraryHost() {
  const open = usePromptLibraryStore((state) => state.open)
  const requestKey = usePromptLibraryStore((state) => state.request?.key)
  if (!open) return null
  // A new request (another field's book button) starts a fresh dialog.
  return <PromptLibraryDialog key={requestKey} />
}
