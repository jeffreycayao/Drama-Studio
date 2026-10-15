import { useState, useCallback, useEffect } from 'react'

function ResizeHandle({ 
  direction = 'horizontal', // 'horizontal' (left-right) or 'vertical' (up-down)
  onResize,
  className = ''
}) {
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return
    
    if (direction === 'horizontal') {
      onResize(e.clientX)
    } else {
      onResize(e.clientY)
    }
  }, [isDragging, direction, onResize])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none'
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp, direction])

  const baseStyles = direction === 'horizontal' 
    ? 'w-1 cursor-col-resize hover:bg-sf-accent/50 active:bg-sf-accent' 
    : 'h-1 cursor-row-resize hover:bg-sf-accent/50 active:bg-sf-accent'

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        ${baseStyles}
        ${isDragging ? 'bg-sf-accent' : 'bg-transparent'}
        transition-colors duration-150
        flex-shrink-0
        z-10
        group
        ${className}
      `}
    >
      {/* Visual indicator on hover */}
      <div 
        className={`
          ${direction === 'horizontal' ? 'w-0.5 h-full mx-auto' : 'h-0.5 w-full my-auto'}
          ${isDragging ? 'bg-sf-accent' : 'bg-sf-dark-600 group-hover:bg-sf-accent/70'}
          transition-colors
        `}
      />
    </div>
  )
}

export default ResizeHandle
