"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { AssetsPanel } from "./assets-panel";
import { TargetsPanel } from "./targets-panel";
import { ContributionPanel } from "./contribution-panel";
import { QuestionsPanel } from "./questions-panel";
import type { BrapiCredentialStatus } from "./brapi-credentials";
import type { DiagramQuestionDto, PortfolioDto } from "./types";

const CountryMap = dynamic(() => import("./country-map"), { ssr: false, loading: () => <div className="grid min-h-[560px] place-items-center rounded-2xl border bg-[var(--card)] text-sm text-[var(--muted-foreground)]">Carregando mapa…</div> });
type Section = "assets" | "targets" | "contribution" | "questions" | "map";

export function PortfolioClient({
  portfolio,
  questions,
  answers,
  brapiCredential,
}: {
  portfolio: PortfolioDto;
  questions: DiagramQuestionDto[];
  answers: { assetId: string; questionId: string; answer: boolean }[];
  brapiCredential: BrapiCredentialStatus;
}) {
  const [section, setSection] = useState<Section>("assets");
  const [visitedSections, setVisitedSections] = useState<Set<Section>>(() => new Set(["assets"]));

  function changeSection(nextSection: Section) {
    setVisitedSections((current) => {
      if (current.has(nextSection)) return current;
      const next = new Set(current);
      next.add(nextSection);
      return next;
    });
    setSection(nextSection);
  }

  return (
    <div className="space-y-6">
      <SegmentedTabs value={section} onValueChange={changeSection} ariaLabel="Seções da carteira" options={[{ value: "assets", label: "Ativos" }, { value: "targets", label: "Metas" }, { value: "contribution", label: "Aportar" }, { value: "questions", label: "Perguntas" }, { value: "map", label: "Mapa" }]} />
      {visitedSections.has("assets") && <section hidden={section !== "assets"}><AssetsPanel assets={portfolio.assets} fixedIncomeFamilies={portfolio.fixedIncomeFamilies} catalog={portfolio.catalog} questions={questions} initialAnswers={answers} brapiCredential={brapiCredential} /></section>}
      {visitedSections.has("targets") && <section hidden={section !== "targets"}><TargetsPanel initialTargets={portfolio.targets} /></section>}
      {visitedSections.has("contribution") && <section hidden={section !== "contribution"}><ContributionPanel assets={portfolio.assets} catalog={portfolio.catalog} /></section>}
      {visitedSections.has("questions") && <section hidden={section !== "questions"}><QuestionsPanel questions={questions} /></section>}
      {visitedSections.has("map") && <section hidden={section !== "map"}><CountryMap /></section>}
    </div>
  );
}
