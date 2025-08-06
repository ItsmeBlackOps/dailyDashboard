import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  {
    name: 'New',
    value: 45,
  },
  {
    name: 'Qualified',
    value: 38,
  },
  {
    name: 'Proposal',
    value: 31,
  },
  {
    name: 'Negotiation',
    value: 24,
  },
  {
    name: 'Closing',
    value: 18,
  },
  {
    name: 'Closed',
    value: 13,
  },
];

export function SalesPipeline() {
  return (
    <Card className="dashboard-card">
      <CardHeader className="mb-6 p-0">
        <CardTitle className="text-lg font-medium">Sales Pipeline</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-4">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              width={500}
              height={300}
              data={data}
              margin={{
                top: 5,
                right: 0,
                left: -38,
                bottom: 5,
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                }}
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
              />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
