"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { formatCalendarDate, formatDateOnly } from "@/lib/calendar";
import { formatCurrency, formatMoney } from "@/lib/money";
import type { AssetHoldingDto } from "../types";
import type { ReviewForm } from "./model";
export function TemporaryQuantityBadge({ metadata }: {
  metadata: AssetHoldingDto["connectedMetadata"];
}) {
  if (!metadata?.overrideFields.includes("QUANTITY"))
    return null;
  return <span className="text-[10px] font-semibold text-[var(--primary)]">Quantidade temporária</span>;
}
export function ProviderQuantity({ metadata }: {
  metadata: AssetHoldingDto["connectedMetadata"];
}) {
  if (!metadata?.overrideFields.includes("QUANTITY"))
    return null;
  return (<span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">
    Instituição: {metadata.providerMetadata.quantity === null ? "não informada" : <PrivateValue>{Number(metadata.providerMetadata.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue>}
  </span>);
}
function formatRateValue(value: string) {
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export function holdingProfitability(holding: AssetHoldingDto) {
  if (holding.rateValue === null)
    return null;
  const rate = `${formatRateValue(holding.rateValue)}%`;
  const benchmark = holding.benchmark?.trim().toUpperCase();
  if (holding.rateConvention === "INDEXER_PLUS") {
    return benchmark ? `100,00% ${benchmark} + ${rate}` : rate;
  }
  if (holding.rateConvention === "PERCENT_OF_INDEXER") {
    return benchmark ? `${rate} ${benchmark}` : rate;
  }
  if (holding.rateConvention === "FIXED_ANNUAL") {
    return `${rate} a.a.`;
  }
  return benchmark ? `${rate} ${benchmark}` : rate;
}
export function operationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    BUY: "Compra",
    SELL: "Venda",
    TRANSFER: "Transferência",
    DIVIDEND: "Dividendo",
    INTEREST: "Juros",
    AMORTIZATION: "Amortização",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}
export function reviewMoney(value: string, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));
  }
  catch {
    return `${currency} ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
}
export function CostValue({ value, currency }: { value: string | null; currency?: string | null }) {
  if (value === null) return <span title="Indisponível: custo não informado ou moedas incompatíveis.">—</span>;
  return <span className="block">
    <PrivateValue>{currency ? reviewMoney(value, currency) : reviewDecimal(value)}</PrivateValue>
    {!currency && <span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">Moeda do custo não informada</span>}
  </span>;
}
export function reviewDecimal(value: string) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 10 });
}
export function MoneyWithNative({ brl, native, currency, strong = false, nativePrimary = false, unavailable = false, }: {
  brl: string;
  native?: string | null;
  currency?: string | null;
  strong?: boolean;
  nativePrimary?: boolean;
  unavailable?: boolean;
}) {
  const Primary = strong ? "strong" : "span";
  return (<span className="block whitespace-nowrap">
    <Primary>{nativePrimary && native != null && currency ? <PrivateValue>{formatCurrency(native, currency)}</PrivateValue> : unavailable ? "BRL indisponível" : <PrivateValue>{formatMoney(brl)}</PrivateValue>}</Primary>
    {native !== null && native !== undefined && currency && currency !== "BRL" && (<span className="mt-0.5 block text-[10px] font-normal text-[var(--muted-foreground)]">
      {nativePrimary ? unavailable ? "Equivalente BRL indisponível" : <PrivateValue>{formatMoney(brl)}</PrivateValue> : <PrivateValue>{formatCurrency(native, currency)}</PrivateValue>}
    </span>)}
  </span>);
}
export function reviewPercentage(value: string) {
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}
export function pluggyInvestmentSourceLabel(source: AssetHoldingDto["providerInvestmentSource"]) {
  if (source === "ACCOUNT_RESERVED_BALANCE")
    return "Pluggy · Caixinha";
  if (source === "ACCOUNT_AUTOMATIC_BALANCE")
    return "Pluggy · Saldo investido";
  return "Pluggy";
}
export function reviewDate(value: string, timeZone: string) {
  return formatCalendarDate(value, timeZone);
}
export function reviewDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}
export function reviewOperationDate(value: string) {
  return formatDateOnly(value);
}
export function reviewProfitability(review: ReviewForm) {
  const indexer = review.rateType?.trim().toUpperCase();
  const base = review.rate === null ? null : reviewPercentage(review.rate);
  const spread = review.fixedAnnualRate === null ? null : reviewPercentage(review.fixedAnnualRate);
  if (indexer && base && spread)
    return `${base} ${indexer} + ${spread} a.a.`;
  if (indexer && base)
    return `${base} ${indexer}`;
  if (spread)
    return `${spread} a.a.`;
  if (review.annualRate !== null)
    return `${reviewPercentage(review.annualRate)} a.a.`;
  return null;
}
