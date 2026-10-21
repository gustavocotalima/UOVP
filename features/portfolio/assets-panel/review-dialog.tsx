"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/money";
import { FIXED_INCOME_INDEXATIONS, FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPES, INSTRUMENT_TYPE_META, INVESTMENT_CLASSES, INVESTMENT_CLASS_META, RATE_CONVENTIONS, RATE_CONVENTION_META, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey, type RateConventionKey } from "../constants";
import type { ReviewForm } from "./model";
import { PluggyReviewSourceData } from "./review-source-data";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function ReviewDialog({ controller }: {
  controller: Pick<AssetsPanelController, "fixedIncomeFamilies" | "catalog" | "timeZone" | "reviewForm" | "setReviewForm" | "message" | "pending" | "submitReview" | "excludeReview">;
}) {
  const { fixedIncomeFamilies, catalog, timeZone, reviewForm, setReviewForm, message, pending, submitReview, excludeReview } = controller;
  return (<Dialog privateEditor open={reviewForm !== null} mobileMode="full" onOpenChange={(open) => !open && setReviewForm(null)} dismissible={!pending} title={reviewForm?.source === "ACCOUNT_BALANCE" ? "Classificar saldo da conta" : "Revisar integração Pluggy"} className="max-w-5xl" footer={reviewForm && (<>
    <Button type="button" variant="outline" onClick={excludeReview} disabled={pending}>{reviewForm.source === "ACCOUNT_BALANCE" ? "Manter só em Contas" : "Manter só no Open Finance"}</Button>
    <Button type="submit" form="pluggy-review-form" disabled={pending}>{pending ? "Integrando…" : "Integrar ao diagrama"}</Button>
  </>)}>
    {reviewForm && (<form id="pluggy-review-form" onSubmit={submitReview} className="space-y-5">
      {message && <p role="status" className="rounded-xl border p-3 text-sm">{message}</p>}
      <div className="rounded-xl border bg-[var(--muted)]/30 p-4">
        <strong className="block">{reviewForm.investmentName}</strong>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{reviewForm.institution} · {reviewForm.providerType}{reviewForm.providerSubtype ? ` / ${reviewForm.providerSubtype}` : ""}</p>
        <p className="mt-2 font-semibold"><PrivateValue>{formatCurrency(reviewForm.balance, reviewForm.currencyCode)}</PrivateValue></p>
        {reviewForm.reviewReason && <p className="mt-3 text-sm text-[var(--primary)]">{reviewForm.reviewReason}</p>}
      </div>
      {reviewForm.source !== "ACCOUNT_BALANCE" && <PluggyReviewSourceData review={reviewForm} timeZone={timeZone} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="review-instrument">Instrumento</Label>
          <Select id="review-instrument" className="w-full" value={reviewForm.instrumentType} onChange={(event) => {
            const instrumentType = event.target.value as InstrumentTypeKey | "";
            setReviewForm({
              ...reviewForm,
              instrumentType,
              marketRegion: instrumentType === "ETF" && reviewForm.investmentClass === "STORE_OF_VALUE"
                ? reviewForm.marketRegion
                : "",
            });
          }} required>
            <option value="">Selecione</option>
            {INSTRUMENT_TYPES.filter((type) => reviewForm.source !== "ACCOUNT_BALANCE" || type === "FIXED_INCOME").map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="review-exposure">Classe para metas e cálculos</Label>
          <Select id="review-exposure" className="w-full" value={reviewForm.investmentClass} onChange={(event) => {
            const investmentClass = event.target.value as InvestmentClassKey | "";
            setReviewForm({
              ...reviewForm,
              investmentClass,
              marketRegion: reviewForm.instrumentType === "ETF" && investmentClass === "STORE_OF_VALUE"
                ? reviewForm.marketRegion
                : "",
            });
          }} required>
            <option value="">Selecione</option>
            {INVESTMENT_CLASSES.filter((type) => reviewForm.source !== "ACCOUNT_BALANCE" || type === (reviewForm.currencyCode === "USD" ? "INTERNATIONAL_FIXED_INCOME" : "FIXED_INCOME")).map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
          </Select>
        </div>
        {reviewForm.instrumentType === "ETF" && reviewForm.investmentClass === "STORE_OF_VALUE" && (<div className="space-y-2 sm:col-span-2">
          <Label htmlFor="review-market-region">Mercado do ETF</Label>
          <Select id="review-market-region" className="w-full" value={reviewForm.marketRegion} onChange={(event) => setReviewForm({
            ...reviewForm,
            marketRegion: event.target.value as ReviewForm["marketRegion"],
          })} required>
            <option value="">Selecione</option>
            <option value="BRAZIL">Nacional (B3 · brapi)</option>
            <option value="INTERNATIONAL">Internacional (Yahoo Finance)</option>
          </Select>
        </div>)}
        {(reviewForm.instrumentType === "FIXED_INCOME" || (reviewForm.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(reviewForm.investmentClass))) && (<>
          <div className="space-y-2">
            <Label htmlFor="review-family">Família</Label>
            <Select id="review-family" className="w-full" value={reviewForm.familyCode} onChange={(event) => setReviewForm({ ...reviewForm, familyCode: event.target.value })} required>
              <option value="">Selecione</option>
              {fixedIncomeFamilies.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-indexation">Indexação</Label>
            <Select id="review-indexation" className="w-full" value={reviewForm.indexation} onChange={(event) => setReviewForm({ ...reviewForm, indexation: event.target.value as FixedIncomeIndexationKey | "" })} required>
              <option value="">Selecione</option>
              {FIXED_INCOME_INDEXATIONS.map((indexation) => <option key={indexation} value={indexation}>{FIXED_INCOME_INDEXATION_META[indexation].label}</option>)}
            </Select>
          </div>
        </>)}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="review-score">Nota inicial</Label>
          <Input id="review-score" type="number" min="-30" max="30" value={reviewForm.score} onChange={(event) => setReviewForm({ ...reviewForm, score: Number(event.target.value) })} />
          <p className="text-xs text-[var(--muted-foreground)]">Nota 0 inclui o ativo nos totais, mas não nas sugestões de aporte.</p>
          {reviewForm.source === "ACCOUNT_BALANCE" && <p className="text-xs text-[var(--muted-foreground)]">Se o grupo já existir, sua classificação e nota serão preservadas.</p>}
        </div>
        {reviewForm.source === "ACCOUNT_BALANCE" && <>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="account-review-type">Tipo do produto</Label>
            <Select id="account-review-type" className="w-full" value={reviewForm.accountCatalogItemId ?? ""} onChange={(event) => setReviewForm({ ...reviewForm, accountCatalogItemId: event.target.value ? Number(event.target.value) : null })}>
              <option value="">Tipo personalizado</option>{catalog.filter((item) => item.familyCode === reviewForm.familyCode).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </div>
          {!reviewForm.accountCatalogItemId && <div className="space-y-2 sm:col-span-2"><Label htmlFor="account-review-custom">Tipo personalizado</Label><Input id="account-review-custom" value={reviewForm.accountCustomTypeName ?? ""} onChange={(event) => setReviewForm({ ...reviewForm, accountCustomTypeName: event.target.value })} required /></div>}
          <div className="space-y-2"><Label htmlFor="account-review-rate-format">Formato da taxa (opcional)</Label><Select id="account-review-rate-format" className="w-full" value={reviewForm.accountRateConvention ?? ""} onChange={(event) => setReviewForm({ ...reviewForm, accountRateConvention: event.target.value as RateConventionKey || null, accountBenchmark: "", accountRateValue: "" })}><option value="">Não informado</option>{RATE_CONVENTIONS.map((item) => <option key={item} value={item}>{RATE_CONVENTION_META[item]}</option>)}</Select></div>
          {reviewForm.accountRateConvention && <>
            <div className="space-y-2"><Label htmlFor="account-review-rate">Taxa descritiva</Label><Input id="account-review-rate" type="number" step="0.000001" min="0" value={reviewForm.accountRateValue ?? ""} onChange={(event) => setReviewForm({ ...reviewForm, accountRateValue: event.target.value })} /></div>
            {["PERCENT_OF_INDEXER", "INDEXER_PLUS"].includes(reviewForm.accountRateConvention) && <div className="space-y-2"><Label htmlFor="account-review-benchmark">Indexador</Label><Input id="account-review-benchmark" value={reviewForm.accountBenchmark ?? ""} onChange={(event) => setReviewForm({ ...reviewForm, accountBenchmark: event.target.value })} required /></div>}
          </>}
          <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">A taxa é apenas descritiva. O saldo não recebe juros calculados pelo UOVP.</p>
          {!!reviewForm.accountBalanceSource?.automaticBalanceConflicts.length && <div className="rounded-xl border border-[var(--primary)] p-3 text-sm sm:col-span-2">
            <p>Já existe saldo automático desta conta na Carteira: {reviewForm.accountBalanceSource.automaticBalanceConflicts.join(", ")}. Remova a representação duplicada ou confirme abaixo.</p>
            <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={reviewForm.confirmDistinctAutomaticBalance ?? false} onChange={(event) => setReviewForm({ ...reviewForm, confirmDistinctAutomaticBalance: event.target.checked })} />Confirmo que são valores distintos, não o mesmo saldo.</label>
          </div>}
        </>}
      </div>
    </form>)}
  </Dialog>);
}
