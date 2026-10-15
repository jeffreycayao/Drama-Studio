import { useLayoutEffect, useState } from 'react'

/**
 * Given a raw { x, y } anchor point (typically the mouse position at the
 * time a context menu was opened) and a ref to the menu element, returns
 * a clamped position that keeps the entire menu on screen.
 *
 * Flips the menu upward when it would overflow the bottom edge and shifts
 * it left when it would overflow the right edge. Never pushes the menu
 * past the top or left viewport edge (it stays at least `margin` pixels
 * inside the viewport).
 *
 * The hook measures the menu *after* it mounts. useLayoutEffect runs
 * synchronously before the browser paints, so even though the very first
 * render pass positions the menu at the raw coords, the user never sees
 * the unclamped state on screen — the corrected state paints in the
 * same frame.
 *
 * Why not compute offsets at right-click time: we don't know the menu
 * height until React has rendered it, and menus in this app have dynamic
 * content (mask submenus, "Flush render cache" only for cached clips,
 * multi-select variants, etc.), so a hard-coded height estimate would
 * either under-correct on tall menus or over-correct on short ones.
 *
 * @param {object|null} rawPos - The raw anchor { x, y } in viewport coords.
 * @param {object} ref - A ref pointing to the menu's root DOM node.
 * @param {object} [opts]
 * @param {number} [opts.margin=8] - Minimum distance from any viewport edge.
 * @returns {{ x: number, y: number }} The clamped position.
 */
export default function useViewportClampedPosition(rawPos, ref, opts = {}) {
  const { margin = 8 } = opts
  // Initial render always uses the raw coords. If the menu would overflow,
  // the layout effect below rewrites `pos` before the browser paints, so
  // no unclamped position is ever visible to the user.
  const [pos, setPos] = useState(() => rawPos || { x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!rawPos) return
    const el = ref.current
    if (!el) {
      setPos(rawPos)
      return
    }

    const rect = el.getBoundingClientRect()
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0

    let x = rawPos.x
    let y = rawPos.y

    // Bottom overflow: push the menu up just enough that its bottom edge
    // lands `margin` px inside the viewport. If the menu is taller than
    // the viewport (rare — only with extremely dense menus on very short
    // windows), clamp to `margin` so the top is at least visible and the
    // menu's own overflow-auto can take over from there.
    if (y + rect.height > vh - margin) {
      y = Math.max(margin, vh - rect.height - margin)
    }

    // Right overflow: same idea horizontally. For a menu opened near the
    // right edge of the window this effectively flips the anchor from
    // top-left to top-right without needing a CSS transform.
    if (x + rect.width > vw - margin) {
      x = Math.max(margin, vw - rect.width - margin)
    }

    setPos({ x, y })
    // We deliberately key on raw anchor coords only. Re-measuring on
    // every render (e.g. after a submenu expands) would thrash the
    // position mid-interaction; re-measuring on a *new* right-click does
    // the right thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPos?.x, rawPos?.y, margin])

  return pos
}
