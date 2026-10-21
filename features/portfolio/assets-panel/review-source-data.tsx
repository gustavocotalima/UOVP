"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPE_META, INVESTMENT_CLASS_META } from "../constants";
import type { ReviewForm } from "./model";
import { reviewMoney, reviewDecimal, reviewDate, reviewDateTime, reviewOperationDate, reviewProfitability, reviewPercentage } from "./presentation";
export function ReviewDetailsGrid({ title, details }: {
  title: string;
  details: Array<{
    label: string;
    value: string | null;
  }>;
}) {
  const visibleDetails = details.filter((detail): detail is {
    label: string;
    value: string;
  } => detail.value !== null && detail.value !== "");
  if (!visibleDetails.length)
    return null;
  return (<section>
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleDetails.map((detail) => (<div key={detail.label} className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{detail.label}</dt>
        <dd className="mt-1 break-words text-sm font-medium tabular-nums">{detail.value}</dd>
      </div>))}
    </dl>
  </section>);
}
export function PluggyReviewSourceData({ review, timeZone }: {
  review: ReviewForm;
  timeZone: string;
}) {
  const metadataAvailable = Boolean(review.metadata && typeof review.metadata === "object");
  return (<div className="space-y-5 rounded-xl border bg-[var(--muted)]/15 p-4">
    <ReviewDetailsGrid title="Identificação e classificação do provedor" details={[
      { label: "Instituição", value: review.institution },
      { label: "Emissor", value: review.issuer },
      { label: "CNPJ do emissor", value: review.issuerCnpj },
      { label: "CNPJ da instituição", value: review.institutionNumber },
      { label: "Origem do saldo", value: review.source === "ACCOUNT_RESERVED_BALANCE" ? "Caixinha" : review.source === "ACCOUNT_AUTOMATIC_BALANCE" ? "Saldo investido automaticamente" : null },
      { label: "Tipo Pluggy", value: review.providerType },
      { label: "Subtipo Pluggy", value: review.providerSubtype },
      { label: "Código / ticker", value: review.code },
      { label: "ISIN", value: review.isin },
      { label: "Titular", value: review.owner },
      { label: "Número do investimento", value: review.number },
      { label: "Seguradora", value: review.insurerName },
      { label: "CNPJ da seguradora", value: review.insurerCnpj },
      {
        label: "Sugestão automática",
        value: [
          review.suggestedInstrumentType ? INSTRUMENT_TYPE_META[review.suggestedInstrumentType].label : null,
          review.suggestedInvestmentClass ? INVESTMENT_CLASS_META[review.suggestedInvestmentClass].label : null,
        ].filter(Boolean).join(" · ") || null,
      },
      { label: "Família sugerida", value: review.suggestedFamilyCode },
      {
        label: "Indexação sugerida",
        value: review.suggestedIndexation ? FIXED_INCOME_INDEXATION_META[review.suggestedIndexation].label : null,
      },
    ]} />
    <ReviewDetailsGrid title="Posição, valores e rentabilidade" details={[
      { label: "Saldo atual", value: reviewMoney(review.balance, review.currencyCode) },
      { label: "Valor investido", value: review.amountOriginal === null ? null : reviewMoney(review.amountOriginal, review.currencyCode) },
      { label: "Valor bruto informado", value: review.amount === null ? null : reviewMoney(review.amount, review.currencyCode) },
      { label: "Lucro / prejuízo", value: review.amountProfit === null ? null : reviewMoney(review.amountProfit, review.currencyCode) },
      { label: "Disponível para resgate", value: review.amountWithdrawal === null ? null : reviewMoney(review.amountWithdrawal, review.currencyCode) },
      { label: "Quantidade", value: review.quantity === null ? null : reviewDecimal(review.quantity) },
      { label: "Valor unitário", value: review.value === null ? null : reviewMoney(review.value, review.currencyCode) },
      { label: "Rentabilidade contratada", value: reviewProfitability(review) },
      { label: "Indexador informado", value: review.rateType },
      { label: "Percentual do indexador", value: review.rate === null ? null : reviewPercentage(review.rate) },
      { label: "Taxa fixa / spread", value: review.fixedAnnualRate === null ? null : `${reviewPercentage(review.fixedAnnualRate)} a.a.` },
      { label: "Rentabilidade no mês", value: review.lastMonthRate === null ? null : reviewPercentage(review.lastMonthRate) },
      { label: "Rentabilidade em 12 meses", value: review.lastTwelveMonthsRate === null ? null : reviewPercentage(review.lastTwelveMonthsRate) },
      { label: "Rentabilidade anual", value: review.annualRate === null ? null : reviewPercentage(review.annualRate) },
      { label: "Imposto de renda", value: review.taxes === null ? null : reviewMoney(review.taxes, review.currencyCode) },
      { label: "IOF / outros impostos", value: review.taxes2 === null ? null : reviewMoney(review.taxes2, review.currencyCode) },
      { label: "Moeda", value: review.currencyCode },
    ]} />
    <ReviewDetailsGrid title="Datas e situação" details={[
      { label: "Emissão", value: review.issueDate ? reviewDate(review.issueDate, timeZone) : null },
      { label: "Compra", value: review.purchaseDate ? reviewDate(review.purchaseDate, timeZone) : null },
      { label: "Fim da carência", value: review.gracePeriodDate ? reviewDate(review.gracePeriodDate, timeZone) : null },
      { label: "Vencimento", value: review.dueDate ? reviewDate(review.dueDate, timeZone) : null },
      { label: "Data da posição", value: review.quotaDate ? reviewDate(review.quotaDate, timeZone) : null },
      { label: "Status no provedor", value: review.status },
      { label: "Atualizado pela instituição", value: reviewDateTime(review.updatedAt, timeZone) },
    ]} />
    {review.transactions.length > 0 && (<details className="rounded-xl border bg-[var(--card)]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Movimentações informadas ({review.transactions.length})</summary>
      <div className="space-y-2 border-t p-3">
        {review.transactions.map((transaction) => (<div key={transaction.id} className="rounded-lg border px-3 py-2 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <strong>{transaction.type.replaceAll("_", " ")}</strong>
              <p className="mt-0.5 text-[var(--muted-foreground)]">
                {reviewOperationDate(transaction.tradeDate ?? transaction.date)}
                <PrivateValue>{transaction.quantity !== null ? ` · ${reviewDecimal(transaction.quantity)} un.` : ""}</PrivateValue>
                {transaction.description ? ` · ${transaction.description}` : ""}
              </p>
            </div>
            <strong>{transaction.amount === null ? "—" : <PrivateValue>{reviewMoney(transaction.amount, review.currencyCode)}</PrivateValue>}</strong>
          </div>
          <p className="mt-1 text-[var(--muted-foreground)]">
            <PrivateValue>{transaction.value !== null ? `Valor unitário: ${reviewMoney(transaction.value, review.currencyCode)}` : ""}</PrivateValue>
            <PrivateValue>{transaction.netAmount !== null ? `${transaction.value !== null ? " · " : ""}Líquido: ${reviewMoney(transaction.netAmount, review.currencyCode)}` : ""}</PrivateValue>
            {transaction.agreedRate !== null ? ` · Taxa acordada: ${reviewPercentage(transaction.agreedRate)}` : ""}
            {transaction.brokerageNumber ? ` · Nota: ${transaction.brokerageNumber}` : ""}
          </p>
          {transaction.expenses !== null && transaction.expenses !== undefined && (<details className="mt-2">
            <summary className="cursor-pointer text-[var(--primary)]">Despesas brutas</summary>
            <pre className="private-value mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-[10px]">{JSON.stringify(transaction.expenses, null, 2)}</pre>
          </details>)}
        </div>))}
      </div>
    </details>)}
    {metadataAvailable && (<details className="rounded-xl border bg-[var(--card)]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Metadados brutos do Pluggy</summary>
      <pre className="private-value max-h-80 overflow-auto whitespace-pre-wrap border-t p-4 text-[11px]">{JSON.stringify(review.metadata, null, 2)}</pre>
    </details>)}
  </div>);
}
