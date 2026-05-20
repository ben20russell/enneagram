"use client";

import { useMemo } from "react";

const EXAMPLE_REPORTS = [
  {
    id: "type-1",
    title: "Type 1 Example",
    subtitle: "Principled Improver",
    summary: "Focuses on standards, structure, and doing things correctly under pressure.",
  },
  {
    id: "type-2",
    title: "Type 2 Example",
    subtitle: "Supportive Connector",
    summary: "Builds trust quickly and anticipates team needs before being asked.",
  },
  {
    id: "type-3",
    title: "Type 3 Example",
    subtitle: "Driven Achiever",
    summary: "Optimizes for momentum, visible outcomes, and clear performance goals.",
  },
  {
    id: "type-4",
    title: "Type 4 Example",
    subtitle: "Insightful Individualist",
    summary: "Brings depth, originality, and emotional signal to strategic decisions.",
  },
  {
    id: "type-5",
    title: "Type 5 Example",
    subtitle: "Analytical Specialist",
    summary: "Finds patterns fast, clarifies complexity, and prefers precise context.",
  },
  {
    id: "type-6",
    title: "Type 6 Example",
    subtitle: "Reliable Guardian",
    summary: "Surfaces risks early and strengthens plans with practical contingencies.",
  },
  {
    id: "type-7",
    title: "Type 7 Example",
    subtitle: "Optimistic Explorer",
    summary: "Generates options rapidly and maintains energy during uncertain phases.",
  },
  {
    id: "type-8",
    title: "Type 8 Example",
    subtitle: "Decisive Challenger",
    summary: "Moves quickly, protects the team, and acts directly in high-stakes moments.",
  },
  {
    id: "type-9",
    title: "Type 9 Example",
    subtitle: "Steady Harmonizer",
    summary: "Creates alignment, lowers friction, and keeps groups working together.",
  },
];

export default function RandomExampleReportPreview() {
  const selectedExample = useMemo(() => {
    const index = Math.floor(Math.random() * EXAMPLE_REPORTS.length);
    const chosen = EXAMPLE_REPORTS[index];
    console.log("[home] Randomized example report selected", {
      selectedExampleId: chosen.id,
      selectedExampleTitle: chosen.title,
    });
    return chosen;
  }, []);

  return (
    <section
      data-testid="random-example-report"
      style={{
        marginTop: "18px",
        textAlign: "left",
        border: "1px solid #d6e2ef",
        borderRadius: "12px",
        padding: "14px",
        background: "#f8fbff",
      }}
    >
      <p
        style={{
          margin: "0 0 8px 0",
          fontSize: "11px",
          fontWeight: 700,
          color: "#5d7694",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        Example Report
      </p>
      <h2 data-testid="random-example-title" style={{ margin: "0 0 6px 0", fontSize: "18px", color: "#10223d" }}>
        {selectedExample.title}
      </h2>
      <p data-testid="random-example-subtitle" style={{ margin: "0 0 8px 0", color: "#36506f", fontWeight: 600 }}>
        {selectedExample.subtitle}
      </p>
      <p data-testid="random-example-summary" style={{ margin: 0, color: "#36506f", fontSize: "14px" }}>
        {selectedExample.summary}
      </p>
    </section>
  );
}
