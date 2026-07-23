"use client";

import { useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FINANCE_FAQ = [
  { category: "Segurança", question: "É seguro conectar minhas contas bancárias ao aplicativo?", answer: "Sim. Utilizamos o protocolo Open Finance, regulamentado pelo Banco Central, que garante a segurança na troca de informações entre instituições financeiras. Os dados são criptografados e você tem total controle sobre o que deseja compartilhar." },
  { category: "Segurança", question: "Preciso compartilhar minhas senhas bancárias?", answer: "Não. O Open Finance não exige o compartilhamento de senhas. A conexão é feita por meio de autorizações seguras entre a empresa Pluggy, o banco e nossa plataforma. O processo de autenticação segue as diretrizes exigidas pela Lei Geral de Proteção de Dados Pessoais e você pode controlar o acesso ao compartilhamento de dados através do seu banco a qualquer momento." },
  { category: "Conectividade", question: "Quais bancos posso conectar?", answer: "Você poderá conectar qualquer instituição participante do Open Finance no Brasil disponibilizada pela Pluggy. Estão inclusos os principais bancos, fintechs e cooperativas brasileiras." },
  { category: "Controle", question: "Posso desconectar minha conta a qualquer momento?", answer: "A qualquer momento você pode revogar o acesso ao compartilhamento dos dados das suas transações. Para isso, basta entrar em contato com a instituição financeira e revogar o acesso diretamente via aplicativo, site ou atendimento da instituição bancária. A maioria dos bancos oferece gestão automática do compartilhamento de dados do Open Finance em seus aplicativos." },
  { category: "Privacidade", question: "Meus dados são compartilhados com terceiros?", answer: "Não. Seus dados são usados exclusivamente para os serviços oferecidos pela ferramenta e não serão vendidos ou repassados a terceiros sem a sua autorização prévia." },
  { category: "Segurança", question: "Quais medidas de segurança são usadas?", answer: "Além da criptografia, usamos autenticação em dois fatores, monitoramento contínuo e práticas recomendadas de segurança cibernética." },
  { category: "Acesso", question: "Posso usar em mais de um dispositivo?", answer: "Sim, você pode acessar a ferramenta pelo celular ou pelo navegador do seu computador, usando o mesmo login. Caso tenha algum problema de acesso, entre em contato com o suporte." },
  { category: "Funcionalidade", question: "Como funciona a plataforma?", answer: "O controlador financeiro é uma ferramenta de gestão de finanças pessoais que utiliza o método do diagrama do cerrado para alcançar a liberdade financeira. Você consegue visualizar gastos, dimensionar aportes, estruturar sua carteira e traçar as metas necessárias para alcançar seus objetivos." },
  { category: "Funcionalidade", question: "É obrigatório autorizar o compartilhamento de dados via Open Finance?", answer: "Não. A plataforma foi desenvolvida para facilitar a gestão financeira via Open Finance ou por meio da inclusão manual de entradas e saídas. Assim, é possível ter uma visão clara de renda, gastos, transações e metas." },
  { category: "Acesso", question: "O acesso é gratuito?", answer: "O acesso a esta instalação é definido pelo administrador da aplicação." },
  { category: "Acesso", question: "Por quanto tempo terei acesso à plataforma?", answer: "Você terá acesso enquanto sua conta nesta aplicação permanecer ativa." },
  { category: "Funcionalidade", question: "Qual o histórico de dados que consigo visualizar?", answer: "Ao conectar uma conta, a Pluggy pode disponibilizar dados de até 365 dias anteriores. A partir da primeira conexão, e mantendo-a ativa na ferramenta, os dados sincronizados ficam armazenados na sua conta." },
] as const;

export function FinanceFaqClient() {
  const [open, setOpen] = useState<string>();
  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-semibold">Dúvidas mais comuns</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Clique nas perguntas abaixo para ver as respostas detalhadas</p></div>
      <Card className="overflow-hidden"><CardContent className="divide-y p-0">{FINANCE_FAQ.map((item) => { const expanded = open === item.question; return <div key={item.question}><button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : item.question)} className="flex w-full items-center gap-4 p-5 text-left"><div className="min-w-0 flex-1"><h3 className="font-semibold">{item.question}</h3><span className="mt-2 inline-block rounded-full bg-[var(--primary)]/12 px-2.5 py-1 text-[10px] font-semibold text-[var(--primary)]">{item.category}</span></div><ChevronDown className={cn("size-5 shrink-0 transition", expanded && "rotate-180")} /></button>{expanded && <p className="px-5 pb-5 text-sm leading-7 text-[var(--muted-foreground)]">{item.answer}</p>}</div>; })}</CardContent></Card>
      <Card className="bg-[#11120f] text-white"><CardContent className="flex flex-col items-center gap-4 p-7 text-center"><span className="grid size-12 place-items-center rounded-full bg-[#d2ad50]/15 text-[#d2ad50]"><MessageCircle className="size-5" /></span><div><h3 className="text-lg font-semibold">Não encontrou sua resposta?</h3><p className="mt-1 text-sm text-white/55">Nossa equipe de suporte está pronta para ajudar você com qualquer dúvida adicional.</p></div><Button asChild><a href="https://api.whatsapp.com/send?phone=556234139882&text=Ol%C3%A1,%20preciso%20de%20ajuda%20no%20finanças!" target="_blank" rel="noreferrer">Falar com o suporte</a></Button></CardContent></Card>
    </div>
  );
}
