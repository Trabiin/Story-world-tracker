/**
 * Zoom buttons on the map (MK-28), for a touchscreen or a touchpad where the wheel is awkward,
 * plus the ways to frame the world that used to crowd the top toolbar.
 */
export function ZoomControls(props: {
  onZoom: (factor: number) => void;
  onFitPlaces: () => void;
  onWholeGlobe: () => void;
  globe: boolean;
  onGlobe: () => void;
  panelHidden: boolean;
  onPanel: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  return (
    <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
      <div className="zoom-group">
        <button onClick={() => props.onZoom(2)} title="Zoom in (+, double-click, pinch, or Shift-drag a box)" aria-label="Zoom in">+</button>
        <button onClick={() => props.onZoom(0.5)} title="Zoom out (−, Shift + double-click)" aria-label="Zoom out">−</button>
      </div>
      <div className="zoom-group">
        <button onClick={props.onFitPlaces} title="Fit all places in view" aria-label="Fit places"><svg viewBox="0 0 18 18"><path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" /><circle cx="9" cy="9" r="2" /></svg></button>
        <button onClick={props.onWholeGlobe} title="Show the whole world" aria-label="Whole world"><svg viewBox="0 0 18 18"><rect x="1.5" y="4" width="15" height="10" rx="1" /><path d="M1.5 9h15M9 4v10" /></svg></button>
        <button className={props.globe ? 'on' : ''} onClick={props.onGlobe} title="Show the world as a sphere" aria-label="Globe"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" /><ellipse cx="9" cy="9" rx="3" ry="7" /><path d="M2 9h14" /></svg></button>
      </div>
      <div className="zoom-group">
        <button className={props.panelHidden ? 'on' : ''} onClick={props.onPanel} title={props.panelHidden ? 'Show the side panel' : 'Hide the side panel: the map gets the whole width'} aria-label={props.panelHidden ? 'Show side panel' : 'Hide side panel'}>
          <svg viewBox="0 0 18 18"><rect x="1.5" y="2.5" width="15" height="13" rx="1" /><path d={props.panelHidden ? 'M12 2.5v13' : 'M12 2.5v13M13.5 6l1.5 3-1.5 3'} /></svg>
        </button>
        {document.fullscreenEnabled && (
          <button className={props.fullscreen ? 'on' : ''} onClick={props.onFullscreen} title={props.fullscreen ? 'Leave full screen (Esc)' : 'Map full screen'} aria-label="Full screen">
            <svg viewBox="0 0 18 18"><path d={props.fullscreen ? 'M6 2v4H2M12 2v4h4M16 12h-4v4M2 12h4v4' : 'M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4'} /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
