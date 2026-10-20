// Tracks whether the open project has unsaved changes, so autosave can skip
// the expensive save path (full getProjectData serialization, a playhead
// thumbnail capture, and two disk writes) when nothing changed.
//
// Store updates here are immutable, so a changed top-level reference is a
// reliable "this slice really changed" signal — the same property the
// debounced persist storage in timelineStore relies on. Volatile fields
// (playhead, isPlaying, selection) are simply not in the watched key lists,
// so playback and scrubbing never mark the project dirty.
//
// This module imports nothing. projectStore imports markProjectClean from
// here, and App wires the store watchers in — keeping the dependency graph
// acyclic.

// Mirrors timelineStore.getProjectData(). Keep in sync when that changes.
export const TIMELINE_PROJECT_KEYS = [
  'duration',
  'zoom',
  'masterAudioVolume',
  'masterAudioInserts',
  'tracks',
  'clips',
  'transitions',
  'markers',
  'clipCounter',
  'transitionCounter',
  'markerCounter',
  'snappingEnabled',
  'snappingThreshold',
  'rippleEditMode',
]

// Mirrors what saveProject reads from the assets store.
export const ASSETS_PROJECT_KEYS = [
  'assets',
  'folders',
  'folderCounter',
]

// Project-level fields that land in the saved JSON. currentProject covers
// renames and settings edits; saveProject records its own currentProject
// update inside withoutDirtyTracking, so only real edits count.
export const PROJECT_STORE_KEYS = [
  'currentProject',
  'currentTimelineId',
]

// A change counter instead of a flag: a save records the count it gathered
// at, so edits made while it waits for the disk stay unsaved (dirty).
let changes = 0
let savedAt = 0
let untracked = 0

export function markProjectDirty() {
  if (untracked === 0) changes += 1
}

export function markProjectClean() {
  savedAt = changes
}

/** Change count to pass to markProjectSavedAt once the gathered data is on disk. */
export function getProjectChangeCount() {
  return changes
}

/** The project is saved up to `count`; later edits stay dirty. */
export function markProjectSavedAt(count) {
  if (count > savedAt) savedAt = count
}

/** Runs store updates that only record a save (not edits) without marking dirty. */
export function withoutDirtyTracking(update) {
  untracked += 1
  try { return update() } finally { untracked -= 1 }
}

export function isProjectDirty() {
  return changes !== savedAt
}

function anyKeyChanged(state, previousState, keys) {
  if (!state || !previousState) return true
  for (const key of keys) {
    if (state[key] !== previousState[key]) return true
  }
  return false
}

export function watchStoreForProjectChanges(store, keys) {
  return store.subscribe((state, previousState) => {
    // Compound Open/Back swaps the editor's visible document. Pure navigation
    // is not a project edit; an edited Back explicitly opts into dirtying.
    if (keys === TIMELINE_PROJECT_KEYS && previousState
      && state.compoundNavigationRevision !== previousState.compoundNavigationRevision
      && !state.compoundNavigationChangedDocument) return
    // Temporary selection-focus navigation changes only the visible zoom.
    // Never clear existing dirty state or hide other simultaneous authored edits.
    if (keys === TIMELINE_PROJECT_KEYS && previousState
      && state.viewportNavigationRevision !== previousState.viewportNavigationRevision
      && state.viewportNavigation?.zoom === state.zoom) {
      if (anyKeyChanged(state, previousState, keys.filter(key => key !== 'zoom'))) markProjectDirty()
      return
    }
    if (anyKeyChanged(state, previousState, keys)) markProjectDirty()
  })
}

// App calls this once with the real store hooks. Returns a stop function.
export function attachProjectDirtyWatchers({ timelineStore, assetsStore, projectStore }) {
  const unsubscribers = [
    watchStoreForProjectChanges(timelineStore, TIMELINE_PROJECT_KEYS),
    watchStoreForProjectChanges(assetsStore, ASSETS_PROJECT_KEYS),
    watchStoreForProjectChanges(projectStore, PROJECT_STORE_KEYS),
  ]
  return () => {
    unsubscribers.forEach((unsubscribe) => {
      try { unsubscribe?.() } catch (_) { /* already stopped */ }
    })
  }
}
