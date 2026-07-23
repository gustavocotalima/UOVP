import { PageHeader } from "@/components/ui/page-header";
import { FinanceFaqClient } from "@/features/finance/finance-faq-client";
import { FaqClient } from "@/features/faq/faq-client";

export const metadata = { title: "FAQ" };

export default async function FaqPage({ searchParams }: { searchParams: Promise<{ categoria?: string }> }) {
  const category = (await searchParams).categoria;
  return (
    <div className="space-y-7">
      <PageHeader title="Perguntas Frequentes" description="Encontre respostas para as principais dúvidas sobre segurança, conectividade e uso da plataforma." />
      {category ? <FaqClient requestedCategory={category} /> : <FinanceFaqClient />}
    </div>
  );
}
