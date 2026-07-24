"use client";

import dynamic from "next/dynamic";
import { memo, useState } from "react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type { DiagramQuestionDto, PortfolioDto } from "./types";

const PanelLoading = () => (
  <div className="grid min-h-64 place-items-center rounded-2xl border bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
    Carregando…
  </div>
);
const AssetsPanel = dynamic(
  () => import("./assets-panel").then((module) => module.AssetsPanel),
  { loading: PanelLoading },
);
const TargetsPanel = dynamic(
  () => import("./targets-panel").then((module) => module.TargetsPanel),
  { loading: PanelLoading },
);
const ContributionPanel = dynamic(
  () => import("./contribution-panel").then((module) => module.ContributionPanel),
  { loading: PanelLoading },
);
const QuestionsPanel = dynamic(
  () => import("./questions-panel").then((module) => module.QuestionsPanel),
  { loading: PanelLoading },
);
const CountryMap = dynamic(() => import("./country-map"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[560px] place-items-center rounded-2xl border bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
      Carregando mapa…
    </div>
  ),
});
const MemoAssetsPanel = memo(AssetsPanel);
const MemoTargetsPanel = memo(TargetsPanel);
const MemoContributionPanel = memo(ContributionPanel);
const MemoQuestionsPanel = memo(QuestionsPanel);
const MemoCountryMap = memo(CountryMap);
type Section = "assets" | "targets" | "contribution" | "questions" | "map";
const sectionOptions = [
  { value: "assets", label: "Ativos", tabId: "portfolio-tab-assets", panelId: "portfolio-panel-assets" },
  { value: "targets", label: "Metas", tabId: "portfolio-tab-targets", panelId: "portfolio-panel-targets" },
  { value: "contribution", label: "Aportar", tabId: "portfolio-tab-contribution", panelId: "portfolio-panel-contribution" },
  { value: "questions", label: "Perguntas", tabId: "portfolio-tab-questions", panelId: "portfolio-panel-questions" },
  { value: "map", label: "Mapa", tabId: "portfolio-tab-map", panelId: "portfolio-panel-map" },
] as const;

export function PortfolioClient({
  portfolio,
  questions,
  answers,
}: {
  portfolio: PortfolioDto;
  questions: DiagramQuestionDto[];
  answers: { assetId: string; questionId: string; answer: boolean }[];
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
      <SegmentedTabs value={section} onValueChange={changeSection} ariaLabel="Seções da carteira" options={sectionOptions} />
      {visitedSections.has("assets") && <section id="portfolio-panel-assets" role="tabpanel" aria-labelledby="portfolio-tab-assets" hidden={section !== "assets"}><MemoAssetsPanel assets={portfolio.assets} fixedIncomeFamilies={portfolio.fixedIncomeFamilies} catalog={portfolio.catalog} integrationReview={portfolio.integrationReview} questions={questions} initialAnswers={answers} /></section>}
      {visitedSections.has("targets") && <section id="portfolio-panel-targets" role="tabpanel" aria-labelledby="portfolio-tab-targets" hidden={section !== "targets"}><MemoTargetsPanel initialTargets={portfolio.targets} /></section>}
      {visitedSections.has("contribution") && <section id="portfolio-panel-contribution" role="tabpanel" aria-labelledby="portfolio-tab-contribution" hidden={section !== "contribution"}><MemoContributionPanel assets={portfolio.assets} catalog={portfolio.catalog} /></section>}
      {visitedSections.has("questions") && <section id="portfolio-panel-questions" role="tabpanel" aria-labelledby="portfolio-tab-questions" hidden={section !== "questions"}><MemoQuestionsPanel questions={questions} /></section>}
      {visitedSections.has("map") && <section id="portfolio-panel-map" role="tabpanel" aria-labelledby="portfolio-tab-map" hidden={section !== "map"}><MemoCountryMap /></section>}
    </div>
  );
}
