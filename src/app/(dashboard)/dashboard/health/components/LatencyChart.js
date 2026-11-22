"use client";

import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function LatencyChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="latency" fill="var(--chart-1)" name="Latency" />
        <Bar dataKey="ttft" fill="var(--chart-2)" name="TTFT" />
      </BarChart>
    </ResponsiveContainer>
  );
}
