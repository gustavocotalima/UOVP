"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FAQ_SEED } from "./data";

export function FaqClient({ requestedCategory }: { requestedCategory?: string }) {
  const initial = FAQ_SEED.find((category) => category.slug === requestedCategory)?.slug ?? FAQ_SEED[0].slug;
  const [category, setCategory] = useState<string>(initial);
  const [openQuestion, setOpenQuestion] = useState<string>();
  useEffect(() => { const match = FAQ_SEED.find((item) => item.slug === requestedCategory); if (match) setCategory(match.slug); }, [requestedCategory]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {FAQ_SEED.map((group) => {
          const expanded = category === group.slug;
          return <Card key={group.slug} className="overflow-hidden"><button type="button" aria-expanded={expanded} onClick={() => setCategory(expanded ? "" : group.slug)} className="flex min-h-16 w-full items-center justify-between px-5 text-left text-lg font-semibold"><span>{group.title}</span><ChevronDown className={cn("size-5 transition", expanded && "rotate-180")} /></button>{expanded && <div className="border-t p-3">{group.items.map((item) => { const key = `${group.slug}:${item.question}`; const open = openQuestion === key; return <div key={item.question} className="border-b last:border-0"><button type="button" aria-expanded={open} onClick={() => setOpenQuestion(open ? undefined : key)} className="flex min-h-14 w-full items-center justify-between gap-4 px-2 py-3 text-left text-sm font-medium"><span>{item.question}</span><ChevronDown className={cn("size-4 shrink-0 transition", open && "rotate-180")} /></button>{open && <p className="px-2 pb-5 text-sm leading-6 text-[var(--muted-foreground)]">{item.answer}</p>}</div>; })}</div>}</Card>;
        })}
      </div>
      <Card className="h-fit bg-[#11120f] text-white lg:sticky lg:top-8"><CardHeader><span className="mb-3 grid size-11 place-items-center rounded-xl bg-[#d2ad50]/15 text-[#d2ad50]"><MessageCircle className="size-5" /></span><CardTitle className="text-2xl">Fale conosco</CardTitle><p className="text-sm leading-6 text-white/55">Se não encontrou sua resposta, fale com o suporte.</p></CardHeader><CardContent className="space-y-4"><Button asChild className="w-full"><a href="https://sard.ink/atendimento-auvp" target="_blank" rel="noreferrer">Abrir atendimento</a></Button><div className="rounded-2xl bg-white p-4 text-center"><Image width={160} height={160} unoptimized className="mx-auto size-40" src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=https%3A%2F%2Fsard.ink%2Fatendimento-auvp" alt="QR Code para abrir o atendimento" /><p className="mt-2 text-xs text-black/60">Aponte a câmera para o QR Code</p></div></CardContent></Card>
    </div>
  );
}
