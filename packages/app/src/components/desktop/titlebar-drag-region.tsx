import { getIsElectronRuntime } from "@/constants/layout";
import { isNative } from "@/constants/platform";

/**
 * VS Code-style titlebar drag region for Electron.
 *
 * Copied from VS Code at commit daa0a70:
 *   - titlebarPart.ts:463-464  → prepend(container, $('div.titlebar-drag-region'))
 *   - titlebarpart.css:57-64   → position: absolute, full size, -webkit-app-region: drag
 *   - titlebarpart.css:249-260 → top-edge resizer, no-drag, 4px
 *
 * VS Code's drag region is a static DOM element — no z-index, no pointer-events,
 * no state, no event listeners. Interactive elements get no-drag from their own
 * CSS (global backstop in index.html). The drag region never re-renders.
 *
 * The resizer is Windows/Linux only (titlebarpart.css:249 scopes to .windows/.linux).
 * On macOS, Electron handles edge resize natively.
 */

export const titlebarDragSurfaceStyle: React.CSSProperties = {
  cursor: "default",
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "drag",
};

const DRAG_OVERLAY_STYLE: React.CSSProperties = {
  ...titlebarDragSurfaceStyle,
  top: 0,
  left: 0,
  display: "block",
  position: "absolute",
  width: "100%",
  height: "100%",
};

const TOP_RESIZER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: "100%",
  height: 4,
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "no-drag",
};

const NO_DRAG_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "no-drag",
};

/**
 * Takes its children out of a surrounding drag region. The global backstop in index.html
 * covers buttons, links and focusable elements; content that reacts to hover without being
 * any of those (a plugin card that shows more on pointerenter) needs this, or Electron
 * swallows its pointer events as window dragging. Renders the children as they are off
 * Electron.
 */
export function TitlebarNoDragRegion({ children }: { children: React.ReactNode }): React.ReactNode {
  if (isNative || !getIsElectronRuntime()) {
    return children;
  }
  return <div style={NO_DRAG_STYLE}>{children}</div>;
}

/**
 * Static drag overlay and top-edge resizer. Returns null on non-Electron.
 * Place as FIRST child of any positioned container that should be draggable.
 */
export function TitlebarDragRegion() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return (
    <>
      {/* Drag overlay — VS Code .titlebar-drag-region (titlebarpart.css:57-64) */}
      <div style={DRAG_OVERLAY_STYLE} />
      {/* Top-edge resizer — VS Code .resizer (titlebarpart.css:249-256) */}
      <div style={TOP_RESIZER_STYLE} />
    </>
  );
}
