import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function TrendTooltip({ active, payload, label, dateLocale, formatValue }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="trend-tooltip">
      <p className="trend-tooltip-date">{formatDate(label, dateLocale)}</p>
      {payload.map((entry) => (
        <div className="trend-tooltip-row" key={entry.dataKey}>
          <span className="trend-tooltip-series">
            <i style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <strong>{formatValue(entry.value)}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact Dokipoki-style time-series chart.  Recharts owns hit-testing so a
 * hover always resolves to the nearest daily point and exposes its value.
 */
export default function InteractiveTrendChart({
  data,
  series,
  dateLocale = 'en-US',
  formatValue = (value) => String(value),
  ariaLabel,
}) {
  if (!data?.length) return null;

  return (
    <div className="trend-chart" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 14, right: 10, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="rgba(158, 176, 200, 0.14)" strokeDasharray="3 5" />
          <XAxis
            dataKey="t"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'rgba(180, 200, 230, 0.72)', fontSize: 10 }}
            tickFormatter={(value) => formatDate(value, dateLocale)}
            minTickGap={42}
            padding={{ left: 2, right: 2 }}
          />
          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
          <Tooltip
            cursor={{ stroke: 'rgba(242, 247, 255, 0.42)', strokeWidth: 1, strokeDasharray: '3 4' }}
            content={<TrendTooltip dateLocale={dateLocale} formatValue={formatValue} />}
            isAnimationActive={false}
          />
          {series.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={line.strokeWidth ?? 2.25}
              strokeDasharray={line.dashed ? '5 4' : undefined}
              dot={false}
              activeDot={{ r: 4.5, fill: '#070a14', stroke: line.color, strokeWidth: 2.5 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
