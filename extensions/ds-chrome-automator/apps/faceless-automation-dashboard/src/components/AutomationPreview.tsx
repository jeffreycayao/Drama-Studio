import {
  IconFile,
  IconLayoutGrid,
  IconPointer,
  IconTerminal2,
  IconWorld,
} from '@tabler/icons-react';

const rows = [1, 2, 3, 4, 5, 6];

export function AutomationPreview() {
  return (
    <div className="automation-preview" id="grok-automator">
      <div className="flow-line flow-line--left-top" aria-hidden="true" />
      <div className="flow-line flow-line--left-bottom" aria-hidden="true" />
      <div className="flow-line flow-line--right-top" aria-hidden="true" />
      <div className="flow-line flow-line--right-middle" aria-hidden="true" />
      <div className="flow-line flow-line--right-bottom" aria-hidden="true" />

      <div className="flow-node flow-node--globe">
        <IconWorld aria-hidden="true" focusable="false" stroke={1.5} />
      </div>
      <div className="flow-node flow-node--cursor">
        <IconPointer aria-hidden="true" focusable="false" stroke={1.5} />
      </div>

      <div className="product-window">
        <div className="window-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <i />
        </div>
        <div className="window-body" aria-hidden="true">
          <div className="window-rail">
            {rows.map((row) => (
              <span key={row} className={`window-width-${row}`} />
            ))}
          </div>
          <div className="window-content">
            <i className="window-title" />
            {rows.slice(0, 5).map((row) => (
              <div className="window-row" key={row}>
                <span />
                <i className={`window-width-${row}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flow-node flow-node--grid">
        <IconLayoutGrid aria-hidden="true" focusable="false" stroke={1.5} />
      </div>
      <div className="flow-node flow-node--terminal">
        <IconTerminal2 aria-hidden="true" focusable="false" stroke={1.5} />
      </div>
      <div className="flow-node flow-node--file">
        <IconFile aria-hidden="true" focusable="false" stroke={1.5} />
      </div>

      <span className="flow-dot flow-dot--one" aria-hidden="true" />
      <span className="flow-dot flow-dot--two" aria-hidden="true" />
      <span className="flow-dot flow-dot--three" aria-hidden="true" />
      <span className="flow-dot flow-dot--four" aria-hidden="true" />
      <span className="flow-dot flow-dot--five" aria-hidden="true" />
      <span className="flow-dot flow-dot--six" aria-hidden="true" />
    </div>
  );
}
