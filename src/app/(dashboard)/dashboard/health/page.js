"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardSkeleton, SegmentedControl } from "@/shared/components";
import HealthPanel from "./components/HealthPanel.js";
import MatrixPanel from "./components/MatrixPanel.js";
import LatencyPanel from "./components/LatencyPanel.js";
import ProjectsPanel from "./components/ProjectsPanel.js";
import FallbacksPanel from "./components/FallbacksPanel.js";

const TABS = [
  { value: "health", label: "Health" },
  { value: "matrix", label: "Matrix" },
  { value: "latency", label: "Latency" },
  { value: "projects", label: "Projects" },
  { value: "fallbacks", label: "Fallbacks" },
];

export default function HealthPage() {
  return <Suspense fallback={<CardSkeleton />}><HealthContent /></Suspense>;
}

function HealthContent() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = TABS.some((item) => item.value === params.get("tab")) ? params.get("tab") : "health";
  const change = (value) => { const next = new URLSearchParams(params); next.set("tab", value); router.push(`/dashboard/health?${next}`, { scroll: false }); };
  return <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0"><SegmentedControl options={TABS} value={tab} onChange={change} className="w-full sm:w-auto" />{tab === "health" && <HealthPanel />}{tab === "matrix" && <MatrixPanel />}{tab === "latency" && <LatencyPanel />}{tab === "projects" && <ProjectsPanel />}{tab === "fallbacks" && <FallbacksPanel />}</div>;
}
