import { PageHeader } from "@/components/ui/page-header";
import { FaqClient } from "@/features/faq/faq-client";

export const metadata = { title: "FAQ" };

export default async function FaqPage({ searchParams }: { searchParams: Promise<{ categoria?: string }> }) {
  const params = await searchParams;
  return <div className="space-y-7"><PageHeader eyebrow="Central de ajuda" title="Perguntas frequentes" description="Encontre respostas sobre carteira, orçamento e ferramentas." /><FaqClient requestedCategory={params.categoria} /></div>;
}
