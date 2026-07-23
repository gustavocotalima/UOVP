import { PageHeader } from "@/components/ui/page-header";
import { getBrapiCredentialStatus } from "@/features/portfolio/brapi-credentials";
import { PortfolioClient } from "@/features/portfolio/portfolio-client";
import { getDiagramData, getPortfolioData } from "@/features/portfolio/data";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Carteira" };

export default async function PortfolioPage() {
  const userId = await requireUserId();
  const [portfolio, diagram, brapiCredential] = await Promise.all([
    getPortfolioData(userId),
    getDiagramData(userId),
    getBrapiCredentialStatus(userId),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Patrimônio" title="Carteira" description="Organize ativos, defina metas, avalie sua tese e distribua novos aportes." />
      <PortfolioClient portfolio={portfolio} questions={diagram.questions} answers={diagram.answers} brapiCredential={brapiCredential} />
    </div>
  );
}
