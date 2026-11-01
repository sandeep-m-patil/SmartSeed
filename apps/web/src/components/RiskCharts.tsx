import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { normalizeRiskLevel, RISK_META, RISK_LEVELS } from '../lib/risk';
import type { RiskAnalytics } from '../types';
import { Card } from './Layout';

const CHART_HEIGHT = 220;
const NEUTRAL = '#475569';

function ChartCard({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div role="img" aria-label={summary} style={{ height: CHART_HEIGHT }}>{children}</div>
    </Card>
  );
}

/** Risk charts. Each has a text summary label and the same figures are listed in the tables on the page. */
export function RiskCharts({ data }: { data: RiskAnalytics }) {
  const distribution = RISK_LEVELS.map((l) => ({
    level: RISK_META[l].label,
    key: l,
    count: data.riskDistribution.filter((d) => normalizeRiskLevel(d.level) === l).reduce((s, d) => s + d.count, 0),
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Risk distribution" summary={`Batches by risk level: ${distribution.map((d) => `${d.level} ${d.count}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distribution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="level" /><YAxis allowDecimals={false} /><Tooltip />
            <Bar dataKey="count" name="Batches">{distribution.map((d) => <Cell key={d.key} fill={RISK_META[d.key].chart} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Daily anomalies" summary={`Anomalies per day over ${data.dailyAnomalies.length} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.dailyAnomalies}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip />
            <Line type="monotone" dataKey="count" name="Anomalies" stroke={NEUTRAL} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      {data.geo.length > 0 && (
        <ChartCard title="Scan locations" summary={`${data.geo.length} scan clusters plotted by longitude and latitude`}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="lon" name="Longitude" domain={['auto', 'auto']} />
              <YAxis type="number" dataKey="lat" name="Latitude" domain={['auto', 'auto']} />
              <ZAxis type="number" dataKey="count" range={[40, 400]} name="Scans" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={data.geo} fill={NEUTRAL} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}
