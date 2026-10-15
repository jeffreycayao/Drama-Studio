import { useState } from 'react'
import { ChevronRight, ChevronDown, Film, Plus } from 'lucide-react'

function Sidebar({ scenes }) {
  const [expandedScenes, setExpandedScenes] = useState([1, 2])
  const [selectedShot, setSelectedShot] = useState({ scene: 2, shot: 1 })

  const toggleScene = (sceneId) => {
    setExpandedScenes(prev => 
      prev.includes(sceneId) 
        ? prev.filter(id => id !== sceneId)
        : [...prev, sceneId]
    )
  }

  // Mock shots data
  const getShotsForScene = (sceneId) => {
    const shotCounts = { 1: 3, 2: 5, 3: 2, 4: 1 }
    return Array.from({ length: shotCounts[sceneId] || 0 }, (_, i) => ({
      id: i + 1,
      name: `Shot ${sceneId}.${i + 1}`,
      duration: `${(Math.random() * 3 + 1).toFixed(1)}s`,
      hasImage: Math.random() > 0.3
    }))
  }

  return (
    <div className="h-full bg-sf-dark-900 border-r border-sf-dark-700 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-sf-dark-700 flex items-center justify-between">
        <span className="text-sm font-medium text-sf-text-primary">Scenes</span>
        <button className="p-1 hover:bg-sf-dark-700 rounded transition-colors">
          <Plus className="w-4 h-4 text-sf-text-secondary" />
        </button>
      </div>
      
      {/* Scene List */}
      <div className="flex-1 overflow-y-auto p-2">
        {scenes.map((scene) => (
          <div key={scene.id} className="mb-1">
            {/* Scene Header */}
            <button
              onClick={() => toggleScene(scene.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sf-dark-700 transition-colors"
            >
              {expandedScenes.includes(scene.id) ? (
                <ChevronDown className="w-4 h-4 text-sf-text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-sf-text-muted" />
              )}
              <Film className="w-4 h-4 text-sf-accent" />
              <span className="text-sm text-sf-text-primary flex-1 text-left">
                {scene.id}. {scene.name}
              </span>
              <span className="text-xs text-sf-text-muted">{scene.shots}</span>
            </button>
            
            {/* Shots */}
            {expandedScenes.includes(scene.id) && (
              <div className="ml-6 mt-1 space-y-0.5">
                {getShotsForScene(scene.id).map((shot) => (
                  <button
                    key={shot.id}
                    onClick={() => setSelectedShot({ scene: scene.id, shot: shot.id })}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors ${
                      selectedShot.scene === scene.id && selectedShot.shot === shot.id
                        ? 'bg-sf-accent text-white'
                        : 'hover:bg-sf-dark-700'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-xs ${
                      shot.hasImage ? 'bg-sf-dark-600' : 'bg-sf-dark-700 border border-dashed border-sf-dark-500'
                    }`}>
                      {shot.hasImage ? '🖼' : '?'}
                    </div>
                    <span className="text-xs flex-1">{shot.name}</span>
                    <span className="text-xs text-sf-text-muted">{shot.duration}</span>
                  </button>
                ))}
                <button className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-sf-dark-700 text-sf-text-muted transition-colors">
                  <Plus className="w-4 h-4" />
                  <span className="text-xs">Add Shot</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Footer Stats */}
      <div className="p-3 border-t border-sf-dark-700 text-xs text-sf-text-muted">
        <div className="flex justify-between">
          <span>Total Scenes:</span>
          <span>{scenes.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Total Shots:</span>
          <span>{scenes.reduce((acc, s) => acc + s.shots, 0)}</span>
        </div>
      </div>
    </div>
  )
}

export default Sidebar
