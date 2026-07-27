"use client";

import { CheckCircle2, Download, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstallApp } from "./install-provider";

export function InstallAppCard() {
  const { canPrompt, installed, isIos, promptInstall } = useInstallApp();

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
            <Smartphone className="size-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Instalar UOVP</CardTitle>
            <CardDescription>
              Abra o UOVP como aplicativo, sem alterar seus dados ou ativar funcionamento offline.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {installed ? (
          <div className="flex items-center gap-3 rounded-xl border bg-[var(--success)]/8 p-4 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-[var(--success)]" aria-hidden="true" />
            <p>O UOVP já está instalado neste dispositivo.</p>
          </div>
        ) : canPrompt ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              Instale para abrir em uma janela própria e acessar pela tela inicial.
            </p>
            <Button type="button" onClick={() => void promptInstall()}>
              <Download className="size-4" aria-hidden="true" />
              Instalar UOVP
            </Button>
          </div>
        ) : isIos ? (
          <div className="flex items-start gap-3 rounded-xl border bg-[var(--muted)]/25 p-4">
            <Share className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
            <p className="text-sm leading-6">
              No Safari, toque em <strong>Compartilhar</strong> e depois em{" "}
              <strong>Adicionar à Tela de Início</strong>.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            Use a opção <strong>Instalar aplicativo</strong> no menu do navegador quando ela estiver disponível.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
