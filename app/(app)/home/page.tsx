import Link from "next/link";
import { ArrowUpRight, Headphones, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DonutChart } from "@/components/charts/donut-chart";
import { HomeBudgetCard } from "@/features/budget/home-budget-card";
import { getBudgetHistory } from "@/features/budget/data";
import { getPortfolioData } from "@/features/portfolio/data";
import { INVESTMENT_CLASSES, INVESTMENT_CLASS_META } from "@/features/portfolio/constants";
import { formatMoney, formatPercent } from "@/lib/money";
import { requireUser } from "@/lib/current-user";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireUser();
  const [portfolio, history] = await Promise.all([getPortfolioData(user.id), getBudgetHistory(user.id)]);
  const total = portfolio.assets.reduce((sum, asset) => sum + Number(asset.currentValue), 0);
  const chartData = INVESTMENT_CLASSES.map((investmentClass) => ({ name: INVESTMENT_CLASS_META[investmentClass].label, color: INVESTMENT_CLASS_META[investmentClass].color, value: portfolio.assets.filter((asset) => asset.investmentClass === investmentClass).reduce((sum, asset) => sum + Number(asset.currentValue), 0) })).filter((item) => item.value > 0);
  const lastBudget = history.at(-1);
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Visão geral" title={`Olá, ${user.name?.split(" ")[0] || "investidor"}`} description="Seu patrimônio e planejamento financeiro em uma única visão." actions={<span className="rounded-full border bg-[var(--card)] px-3 py-1 text-xs font-semibold">BRL</span>} />
      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.6fr]">
        <Card><CardHeader><CardTitle>Carteira de investimentos</CardTitle><p className="text-sm text-[var(--muted-foreground)]">{portfolio.assets.length} ativos cadastrados</p></CardHeader><CardContent>{chartData.length ? <><DonutChart data={chartData} centerLabel="Patrimônio" /><div className="space-y-2">{chartData.map((item) => <div key={item.name} className="flex justify-between text-xs"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: item.color }} />{item.name}</span><strong>{formatPercent(total ? item.value / total * 100 : 0)}</strong></div>)}</div></> : <div className="grid h-72 place-items-center text-center text-sm text-[var(--muted-foreground)]"><div><p>Seu patrimônio começa aqui.</p><Button className="mt-4" asChild><Link href="/carteira">Adicionar ativos</Link></Button></div></div>}</CardContent></Card>
        <Card><CardHeader className="sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Histórico do orçamento</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Último mês: {formatMoney(lastBudget?.spent ?? 0)} gastos de {formatMoney(lastBudget?.income ?? 0)} de renda</p></div></CardHeader><CardContent><HomeBudgetCard history={history} /></CardContent></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden"><CardHeader className="flex-row items-start gap-4"><span className="grid size-11 place-items-center rounded-xl bg-[#1ed760]/15 text-[#1ed760]"><Headphones className="size-5" /></span><div><CardTitle>Podcast financeiro</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Conteúdo para continuar evoluindo sua estratégia.</p></div></CardHeader><CardContent><iframe title="Podcast no Spotify" className="h-40 w-full rounded-xl" src="https://open.spotify.com/embed/show/2sdR4ar9uIkc6qmPpsZ7fF?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" /></CardContent></Card>
        <Card className="relative overflow-hidden bg-[#11120f] text-white"><div className="absolute -right-20 -top-20 size-60 rounded-full bg-[#d2ad50]/12" /><CardHeader className="relative flex-row items-start gap-4"><span className="grid size-11 place-items-center rounded-xl bg-[#d2ad50]/15 text-[#d2ad50]"><Users className="size-5" /></span><div><CardTitle>Comunidade</CardTitle><p className="mt-1 max-w-md text-sm leading-6 text-white/55">Compartilhe experiências, compare estratégias e acompanhe discussões sobre investimentos.</p></div></CardHeader><CardContent className="relative"><Button asChild><a href="https://comunidade.auvp.com.br/" target="_blank" rel="noreferrer">Acessar comunidade <ArrowUpRight className="size-4" /></a></Button></CardContent></Card>
      </div>
    </div>
  );
}
