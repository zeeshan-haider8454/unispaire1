// Lightweight charts built from CSS and SVG. They take plain numbers from the API and draw no data of their own.

// Donut chart with a centre label. segments: [{ label, value, color }]
export function Donut({ segments, centerValue, centerLabel, size = 150, thickness = 16 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0ea" strokeWidth={thickness} />
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const length = (s.value / total) * circumference;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            />
          );
          offset += length;
          return el;
        })}
        <text x="50%" y="46%" textAnchor="middle" className="donut-value">{centerValue}</text>
        <text x="50%" y="62%" textAnchor="middle" className="donut-label">{centerLabel}</text>
      </svg>
      <ul className="chart-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal bars. rows: [{ label, value, max, color, display, sub }]
// Each bar is value / max (capped at 100%). Use max = total to show share of a whole.
export function BarList({ rows, empty = 'Nothing to show yet.' }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="bar-list">
      {rows.map((r) => {
        const pct = r.max > 0 ? Math.min((r.value / r.max) * 100, 100) : 0;
        return (
          <li key={r.label}>
            <div className="bar-head">
              <span className="bar-label" title={r.label}>{r.label}</span>
              <span className="bar-value">{r.display ?? r.value}</span>
            </div>
            <div className="bar-track" role="img" aria-label={`${r.label}: ${Math.round(pct)}%`}>
              <div className="bar-fill" style={{ width: `${pct}%`, background: r.color }} />
            </div>
            {r.sub && <div className="bar-sub muted small">{r.sub}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// Column chart for small counts. items: [{ label, value, color }]
export function Columns({ items, height = 140 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="columns" style={{ height }}>
      {items.map((i) => (
        <div key={i.label} className="column">
          <span className="column-value">{i.value}</span>
          <div className="column-bar" style={{ height: `${(i.value / max) * 100}%`, background: i.color }} title={`${i.label}: ${i.value}`} />
          <span className="column-label">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

// Palette used across charts so each status keeps its colour everywhere.
// Names are kept so existing charts need no changes; values follow the campus bulletin palette.
export const CHART_COLORS = {
  teal: '#1e3a5f',
  tealLight: '#4a6b94',
  amber: '#a16207',
  coral: '#b42318',
  navy: '#0f172a',
  slate: '#a8a29e',
  green: '#15803d',
  violet: '#6d5a8e',
};
