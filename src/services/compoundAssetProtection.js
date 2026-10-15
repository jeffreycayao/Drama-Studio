import useProjectStore from '../stores/projectStore'
import useTimelineStore from '../stores/timelineStore'
import { getCompoundAssetDeletionGuard } from '../utils/projectAssetReferences.mjs'

// Read only when an action runs. In particular, do not read stores at module
// initialization: projectStore and assetsStore initialize one another.
export function checkCompoundAssetDeletion(assetIds) {
  return getCompoundAssetDeletionGuard(assetIds, useProjectStore.getState(), useTimelineStore.getState())
}
