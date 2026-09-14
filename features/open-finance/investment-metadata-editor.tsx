"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  RATE_CONVENTIONS,
  RATE_CONVENTION_META,
  type RateConventionKey,
} from "@/features/portfolio/constants";
import type {
  ConnectedInvestmentMetadataDto,
  InvestmentMetadataCatalogItemDto,
  PluggyInvestmentMetadataOverrideField,
} from "@/features/portfolio/types";
import {
  savePluggyInvestmentMetadataOverridesAction,
  type PluggyInvestmentMetadataOverrideInput,
} from "./diagram-actions";

type Mode = "PROVIDER" | "CUSTOM";
type FormState = {
  productName: { mode: Mode; value: string };
  issuer: { mode: Mode; value: string };
  productType: { mode: Mode; catalogItemId: number | null; customTypeName: string };
  rateTerms: {
    mode: Mode;
    rateConvention: RateConventionKey | null;
    benchmark: string;
    rateValue: string;
  };
  purchaseDate: { mode: Mode; value: string };
  maturityDate: { mode: Mode; value: string };
};

function has(fields: PluggyInvestmentMetadataOverrideField[], field: PluggyInvestmentMetadataOverrideField) {
  return fields.includes(field);
}

function dateInput(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function initialForm(metadata: ConnectedInvestmentMetadataDto): FormState {
  return {
    productName: {
      mode: has(metadata.overrideFields, "PRODUCT_NAME") ? "CUSTOM" : "PROVIDER",
      value: metadata.effectiveMetadata.productName,
    },
    issuer: {
      mode: has(metadata.overrideFields, "ISSUER") ? "CUSTOM" : "PROVIDER",
      value: metadata.effectiveMetadata.issuer,
    },
    productType: {
      mode: has(metadata.overrideFields, "PRODUCT_TYPE") ? "CUSTOM" : "PROVIDER",
      catalogItemId: metadata.effectiveMetadata.catalogItemId,
      customTypeName: metadata.effectiveMetadata.customTypeName ?? "",
    },
    rateTerms: {
      mode: has(metadata.overrideFields, "RATE_TERMS") ? "CUSTOM" : "PROVIDER",
      rateConvention: metadata.effectiveMetadata.rateConvention,
      benchmark: metadata.effectiveMetadata.benchmark ?? "",
      rateValue: metadata.effectiveMetadata.rateValue ?? "",
    },
    purchaseDate: {
      mode: has(metadata.overrideFields, "PURCHASE_DATE") ? "CUSTOM" : "PROVIDER",
      value: dateInput(metadata.effectiveMetadata.purchaseDate),
    },
    maturityDate: {
      mode: has(metadata.overrideFields, "MATURITY_DATE") ? "CUSTOM" : "PROVIDER",
      value: dateInput(metadata.effectiveMetadata.maturityDate),
    },
  };
}

function providerRate(metadata: ConnectedInvestmentMetadataDto) {
  const { rate, rateType, fixedAnnualRate, annualRate } = metadata.providerMetadata;
  const parts = [
    rate !== null ? `rate: ${rate}` : null,
    rateType ? `rateType: ${rateType}` : null,
    fixedAnnualRate !== null ? `fixedAnnualRate: ${fixedAnnualRate}` : null,
    annualRate !== null ? `annualRate: ${annualRate}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Não informado";
}

function toPayload(
  metadata: ConnectedInvestmentMetadataDto,
  form: FormState,
): PluggyInvestmentMetadataOverrideInput {
  return {
    linkId: metadata.linkId,
    expectedUpdatedAt: metadata.expectedUpdatedAt,
    productName: { mode: form.productName.mode, value: form.productName.value || null },
    issuer: { mode: form.issuer.mode, value: form.issuer.value || null },
    productType: {
      mode: form.productType.mode,
      catalogItemId: form.productType.catalogItemId,
      customTypeName: form.productType.customTypeName || null,
    },
    rateTerms: {
      mode: form.rateTerms.mode,
      rateConvention: form.rateTerms.rateConvention,
      benchmark: form.rateTerms.benchmark || null,
      rateValue: form.rateTerms.rateValue === "" ? null : Number(form.rateTerms.rateValue),
    },
    purchaseDate: { mode: form.purchaseDate.mode, value: form.purchaseDate.value || null },
    maturityDate: { mode: form.maturityDate.mode, value: form.maturityDate.value || null },
  };
}

function FieldMode({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--primary)]"
      />
      {checked
        ? "Valor personalizado · desmarque para restaurar o valor da instituição"
        : "Usar valor personalizado"}
    </label>
  );
}

export function InvestmentMetadataEditor({
  metadata,
  catalog,
  open,
  onOpenChange,
}: {
  metadata: ConnectedInvestmentMetadataDto | null;
  catalog: InvestmentMetadataCatalogItemDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(metadata ? initialForm(metadata) : null);
  const [message, setMessage] = useState<string>();
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pending, startTransition] = useTransition();


  if (!metadata || !form) return null;
  const fixedIncome = metadata.instrumentType === "FIXED_INCOME";
  const catalogOptions = catalog.filter((item) => item.familyCode === metadata.fixedIncomeFamilyCode);
  const customProductType = form.productType.catalogItemId === null;

  function save(nextForm: FormState, closeAfter = true) {
    setMessage(undefined);
    startTransition(async () => {
      try {
        await savePluggyInvestmentMetadataOverridesAction(toPayload(metadata!, nextForm));
        router.refresh();
        if (closeAfter) onOpenChange(false);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar as informações.");
      }
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save(form!);
  }

  function restoreAll() {
    const providerForm = initialForm({ ...metadata!, overrideFields: [] });
    providerForm.productName.value = metadata!.providerMetadata.productName;
    providerForm.issuer.value = metadata!.providerMetadata.issuer;
    providerForm.purchaseDate.value = dateInput(metadata!.providerMetadata.purchaseDate);
    providerForm.maturityDate.value = dateInput(metadata!.providerMetadata.maturityDate);
    setConfirmRestore(false);
    save(providerForm);
  }

  return (
    <>
      <Dialog
        open={open}
        mobileMode="full"
        onOpenChange={onOpenChange}
        dismissible={!pending}
        title="Editar informações do investimento"
        className="max-w-4xl"
        footer={(
          <>
            {metadata.overrideFields.length > 0 && (
              <Button type="button" variant="outline" onClick={() => setConfirmRestore(true)} disabled={pending}>
                Restaurar tudo
              </Button>
            )}
            <Button type="submit" form="investment-metadata-form" disabled={pending}>
              {pending ? "Salvando…" : "Salvar informações"}
            </Button>
          </>
        )}
      >
        <form id="investment-metadata-form" onSubmit={submit} className="space-y-5">
          <div className="rounded-xl border bg-[var(--muted)]/25 p-4 text-sm">
            <strong>{metadata.effectiveMetadata.productName}</strong>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Os valores financeiros e as movimentações continuam controlados pela instituição.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="metadata-product-name">Nome / descrição</Label>
              <Input id="metadata-product-name" value={form.productName.value} disabled={form.productName.mode === "PROVIDER"} onChange={(event) => setForm({ ...form, productName: { ...form.productName, value: event.target.value } })} />
              <p className="text-xs text-[var(--muted-foreground)]">Instituição: {metadata.providerMetadata.productName}</p>
              <FieldMode checked={form.productName.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, productName: { mode: checked ? "CUSTOM" : "PROVIDER", value: checked ? form.productName.value : metadata.providerMetadata.productName } })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="metadata-issuer">Emissor exibido</Label>
              <Input id="metadata-issuer" value={form.issuer.value} disabled={form.issuer.mode === "PROVIDER"} onChange={(event) => setForm({ ...form, issuer: { ...form.issuer, value: event.target.value } })} />
              <p className="text-xs text-[var(--muted-foreground)]">Instituição: {metadata.providerMetadata.issuer || "Não informado"}</p>
              <FieldMode checked={form.issuer.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, issuer: { mode: checked ? "CUSTOM" : "PROVIDER", value: checked ? form.issuer.value : metadata.providerMetadata.issuer } })} />
            </div>

            {fixedIncome && (
              <>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="metadata-product-type">Tipo do produto</Label>
                  <Select id="metadata-product-type" className="w-full" value={form.productType.catalogItemId ?? ""} disabled={form.productType.mode === "PROVIDER"} onChange={(event) => setForm({ ...form, productType: { ...form.productType, catalogItemId: event.target.value ? Number(event.target.value) : null } })}>
                    <option value="">Outro tipo personalizado</option>
                    {catalogOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                  {form.productType.mode === "CUSTOM" && customProductType && <Input value={form.productType.customTypeName} onChange={(event) => setForm({ ...form, productType: { ...form.productType, customTypeName: event.target.value } })} placeholder="Tipo personalizado" />}
                  <p className="text-xs text-[var(--muted-foreground)]">Instituição: {metadata.providerMetadata.subtype ?? metadata.providerMetadata.type}</p>
                  <FieldMode checked={form.productType.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, productType: { ...form.productType, mode: checked ? "CUSTOM" : "PROVIDER" } })} />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Rentabilidade contratada</Label>
                  <p className="rounded-lg border bg-[var(--muted)]/20 p-3 text-xs text-[var(--muted-foreground)]">Informação bruta: {providerRate(metadata)}</p>
                  <FieldMode checked={form.rateTerms.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, rateTerms: { ...form.rateTerms, mode: checked ? "CUSTOM" : "PROVIDER" } })} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Select aria-label="Formato da taxa" value={form.rateTerms.rateConvention ?? ""} disabled={form.rateTerms.mode === "PROVIDER"} onChange={(event) => {
                      const rateConvention = event.target.value ? event.target.value as RateConventionKey : null;
                      setForm({ ...form, rateTerms: { ...form.rateTerms, rateConvention, benchmark: !rateConvention || rateConvention === "FIXED_ANNUAL" ? "" : form.rateTerms.benchmark, rateValue: rateConvention ? form.rateTerms.rateValue : "" } });
                    }}>
                      <option value="">Não informado</option>
                      {RATE_CONVENTIONS.map((item) => <option key={item} value={item}>{RATE_CONVENTION_META[item]}</option>)}
                    </Select>
                    <Input aria-label="Indexador" value={form.rateTerms.benchmark} disabled={form.rateTerms.mode === "PROVIDER" || form.rateTerms.rateConvention === "FIXED_ANNUAL" || form.rateTerms.rateConvention === null} onChange={(event) => setForm({ ...form, rateTerms: { ...form.rateTerms, benchmark: event.target.value } })} placeholder="CDI, IPCA, Selic" />
                    <Input aria-label="Taxa" type="number" step="0.000001" value={form.rateTerms.rateValue} disabled={form.rateTerms.mode === "PROVIDER" || form.rateTerms.rateConvention === null} onChange={(event) => setForm({ ...form, rateTerms: { ...form.rateTerms, rateValue: event.target.value } })} placeholder="Taxa" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="metadata-purchase-date">Data da compra</Label>
                  <Input id="metadata-purchase-date" type="date" value={form.purchaseDate.value} disabled={form.purchaseDate.mode === "PROVIDER"} onChange={(event) => setForm({ ...form, purchaseDate: { ...form.purchaseDate, value: event.target.value } })} />
                  <p className="text-xs text-[var(--muted-foreground)]">Instituição: {dateInput(metadata.providerMetadata.purchaseDate) || "Não informado"}</p>
                  <FieldMode checked={form.purchaseDate.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, purchaseDate: { mode: checked ? "CUSTOM" : "PROVIDER", value: checked ? form.purchaseDate.value : dateInput(metadata.providerMetadata.purchaseDate) } })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metadata-maturity-date">Vencimento</Label>
                  <Input id="metadata-maturity-date" type="date" value={form.maturityDate.value} disabled={form.maturityDate.mode === "PROVIDER"} onChange={(event) => setForm({ ...form, maturityDate: { ...form.maturityDate, value: event.target.value } })} />
                  <p className="text-xs text-[var(--muted-foreground)]">Instituição: {dateInput(metadata.providerMetadata.maturityDate) || "Não informado"}</p>
                  <FieldMode checked={form.maturityDate.mode === "CUSTOM"} onChange={(checked) => setForm({ ...form, maturityDate: { mode: checked ? "CUSTOM" : "PROVIDER", value: checked ? form.maturityDate.value : dateInput(metadata.providerMetadata.maturityDate) } })} />
                </div>
              </>
            )}
          </div>
          {message && <p role="alert" className="text-sm text-[var(--danger)]">{message}</p>}
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title="Restaurar informações da instituição?"
        description="Todas as correções manuais deste investimento serão removidas e os dados mais recentes da Pluggy voltarão a ser usados."
        confirmLabel="Restaurar tudo"
        pending={pending}
        onConfirm={restoreAll}
      />
    </>
  );
}
