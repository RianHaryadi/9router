"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function ProjectsChart({ data, money }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <XAxis dataKey="project" />
        <YAxis />
        <Tooltip formatter={(v) => money(v)} />
        <Bar dataKey="cost" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
