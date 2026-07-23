export type AssetCatalogSeedItem = {
  id: number;
  category: string;
  name: string;
  summary: string;
  taxPF: string;
  taxPJ: string;
  howToBuy: string;
  costs: string;
  risks: string;
  guarantees: string;
};

export const FIXED_INCOME_FAMILIES = [
  { code: "PUBLIC_TREASURY", name: "Tesouro Direto", shortCode: "TESOURO", sortOrder: 10 },
  { code: "BANK_DEPOSITS_FGC", name: "Depósitos bancários com FGC", shortCode: "CDB/RDB/LC", sortOrder: 60 },
  { code: "COOPERATIVE_DEPOSITS", name: "Depósito cooperativo com FGCoop", shortCode: "RDC", sortOrder: 70 },
  { code: "EXEMPT_CREDIT_LETTERS", name: "Letras de crédito isentas com FGC", shortCode: "LCI/LCA", sortOrder: 80 },
  { code: "FINANCIAL_LETTERS", name: "Letra Financeira", shortCode: "LF", sortOrder: 90 },
  { code: "GUARANTEED_REAL_ESTATE_LETTERS", name: "Letra Imobiliária Garantida", shortCode: "LIG", sortOrder: 100 },
  { code: "SECURITIZED_RECEIVABLES", name: "Recebíveis securitizados", shortCode: "CRI/CRA", sortOrder: 110 },
  { code: "STRUCTURED_OPERATIONS", name: "Certificado de Operações Estruturadas", shortCode: "COE", sortOrder: 120 },
  { code: "CORPORATE_DEBT", name: "Dívida corporativa", shortCode: "DEB/NP", sortOrder: 130 },
] as const;

export type FixedIncomeFamilyCode = (typeof FIXED_INCOME_FAMILIES)[number]["code"];

export const CATALOG_FAMILY_BY_ID: Readonly<Record<number, FixedIncomeFamilyCode>> = {
  1: "PUBLIC_TREASURY",
  2: "PUBLIC_TREASURY",
  3: "PUBLIC_TREASURY",
  4: "PUBLIC_TREASURY",
  15: "PUBLIC_TREASURY",
  16: "PUBLIC_TREASURY",
  17: "PUBLIC_TREASURY",
  5: "BANK_DEPOSITS_FGC",
  22: "BANK_DEPOSITS_FGC",
  19: "BANK_DEPOSITS_FGC",
  23: "COOPERATIVE_DEPOSITS",
  6: "EXEMPT_CREDIT_LETTERS",
  24: "EXEMPT_CREDIT_LETTERS",
  25: "EXEMPT_CREDIT_LETTERS",
  26: "EXEMPT_CREDIT_LETTERS",
  18: "FINANCIAL_LETTERS",
  21: "GUARANTEED_REAL_ESTATE_LETTERS",
  7: "SECURITIZED_RECEIVABLES",
  27: "SECURITIZED_RECEIVABLES",
  28: "STRUCTURED_OPERATIONS",
  8: "CORPORATE_DEBT",
  29: "CORPORATE_DEBT",
  30: "CORPORATE_DEBT",
  31: "CORPORATE_DEBT",
  32: "CORPORATE_DEBT",
};

export const ASSET_CATALOG = [{
    id: 1,
    category: "Renda Fixa - Pública",
    name: "NTN-B (Nota do Tesouro Nacional – Série B)",
    summary: "Tesouro IPCA+ com cupom semestral",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "Existe a taxa de custódia de 0,2% ao ano, que é calculada sobre o valor dos títulos. Essa taxa é provisionada diariamente na posição do investidor a partir da liquidação da operação de compra (D+1). A cobrança ocorre nos casos de venda antecipada, no vencimento do título ou no pagamento de juros. Além disso, pode haver uma taxa cobrada pela instituição financeira, que é livremente acordada com o investidor. O Tesouro Direto disponibiliza em seu site um ranking com as taxas cobradas por cada instituição.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 2,
    category: "Renda Fixa - Pública",
    name: "NTN-B Principal (Nota do Tesouro Nacional – Série B Principal)",
    summary: "Tesouro IPCA+ sem cupom semestral",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "Existe a taxa de custódia de 0,2% ao ano, que é calculada sobre o valor dos títulos. Essa taxa é provisionada diariamente na posição do investidor a partir da liquidação da operação de compra (D+1). A cobrança ocorre nos casos de venda antecipada, no vencimento do título ou no pagamento de juros. Além disso, pode haver uma taxa cobrada pela instituição financeira, que é livremente acordada com o investidor. O Tesouro Direto disponibiliza em seu site um ranking com as taxas cobradas por cada instituição.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 3,
    category: "Renda Fixa - Pública",
    name: "LFT (Letra Financeira do Tesouro)",
    summary: "Título pós-fixado do Tesouro Nacional atrelado à Selic",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "Existe a taxa de custódia de 0,2% ao ano, calculada sobre o valor dos títulos. Essa taxa é provisionada diariamente na posição do investidor a partir da liquidação da operação de compra (D+1). A cobrança ocorre nos casos de venda antecipada, no vencimento do título ou no pagamento de juros. Importante: para o Tesouro Selic, não há cobrança de taxa de custódia para valores até R$ 10.000,00 por CPF. Caso o valor investido ultrapasse esse limite, a taxa será cobrada apenas sobre o valor excedente. Além disso, pode haver uma taxa cobrada pela instituição financeira (corretora ou banco), que é livremente acordada com o investidor. O Tesouro Direto disponibiliza em seu site um ranking com as taxas cobradas por cada instituição.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 4,
    category: "Renda Fixa - Pública",
    name: "LTN (Letra do Tesouro Nacional)",
    summary: "Título prefixado do Tesouro Nacional",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "Existe a taxa de custódia de 0,2% ao ano, que é calculada sobre o valor dos títulos. Essa taxa é provisionada diariamente na posição do investidor a partir da liquidação da operação de compra (D+1). A cobrança ocorre nos casos de venda antecipada, no vencimento do título ou no pagamento de juros. Além disso, pode haver uma taxa cobrada pela instituição financeira, que é livremente acordada com o investidor. O Tesouro Direto disponibiliza em seu site um ranking com as taxas cobradas por cada instituição.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 15,
    category: "Renda Fixa - Pública",
    name: "NTN-F (Tesouro Prefixado com Juros Semestrais)",
    summary: "Título prefixado do Tesouro Nacional com cupom semestral",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "Existe a taxa de custódia de 0,2% ao ano, que é calculada sobre o valor dos títulos. Essa taxa é provisionada diariamente na posição do investidor a partir da liquidação da operação de compra (D+1). A cobrança ocorre nos casos de venda antecipada, no vencimento do título ou no pagamento de juros. Além disso, pode haver uma taxa cobrada pela instituição financeira, que é livremente acordada com o investidor. O Tesouro Direto disponibiliza em seu site um ranking com as taxas cobradas por cada instituição.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 16,
    category: "Renda Fixa - Pública",
    name: "Tesouro RendA+",
    summary: "Título IPCA+ com foco em renda mensal complementar na aposentadoria",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "No Tesouro Renda+, a taxa de custódia também é cobrada apenas em casos de resgate antecipado ou durante o período de recebimento das rendas mensais. Se o investidor mantiver o título até o vencimento e o valor recebido estiver dentro do limite de isenção, não haverá cobrança da taxa. Em caso de venda antecipada, a taxa de custódia da B3 varia conforme o prazo até a data de vencimento. Para pagamentos entre 0 e 10 anos, a taxa aplicada é de 0,50% ao ano sobre o valor vendido. Para os períodos entre 10 e 20 anos, a taxa é de 0,20% ao ano. Já para saídas após 20 anos, a taxa é de 0,10% ao ano. Para investidores que mantiverem o título até o vencimento, a isenção da taxa de custódia se aplica a rendas mensais de até 6 salários-mínimos. Valores que ultrapassarem esse limite estarão sujeitos à cobrança de uma taxa de 0,10% ao ano sobre o excedente. Além de qualquer taxa da instituição financeira que você usar para investir.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 17,
    category: "Renda Fixa - Pública",
    name: "Tesouro Educa+",
    summary: "Título IPCA+ com foco em renda periódica para custear educação",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender os títulos diretamente pela sua corretora ou pelo site do Tesouro Direto.",
    costs: "No Tesouro Educa+, a taxa de custódia é cobrada apenas nos casos de resgate antecipado ou durante o período de recebimento das rendas mensais. Caso o investidor mantenha o título até o vencimento e o valor recebido esteja dentro do limite de isenção estabelecido, não haverá cobrança da taxa. Em situações de venda antecipada, a taxa de custódia da B3 varia de acordo com o tempo decorrido desde o início do investimento. Para saídas entre 0 e 7 anos, a taxa é de 0,50% ao ano sobre o valor vendido. Para saídas entre 7 e 14 anos, a taxa é de 0,20% ao ano. Já para períodos entre 14 anos e o vencimento do título, a taxa é de 0,10% ao ano. Para investidores que mantiverem o título até a data de vencimento, a isenção da taxa de custódia se aplica a rendas mensais de até 4 salários-mínimos. Caso o valor recebido ultrapasse esse limite, será cobrada uma taxa de 0,10% ao ano sobre o valor excedente. Além de qualquer taxa da instituição financeira que você usar para investir.",
    risks: "Ao investir em um título emitido por um país, o investidor fica exposto ao risco soberano, que é o risco de o país não conseguir arcar com suas obrigações financeiras. No entanto, os títulos públicos são geralmente considerados os investimentos mais seguros dentro de uma economia.",
    guarantees: "Como garantia formal, existe a garantia do Tesouro Nacional, que em tese protege valores de até R$ 1.000.000,00. No entanto, na prática, a principal garantia está no fato de o investimento ser em um título emitido por um país, considerado o emissor mais seguro dentro de uma economia."
}, {
    id: 5,
    category: "Renda Fixa - Privada Bancária",
    name: "CDB (Certificado de Depósito Bancário)",
    summary: "Título de renda fixa emitido por bancos para captação de recursos",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender CDB diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por instituições menores."
}, {
    id: 22,
    category: "Renda Fixa - Privada Bancária",
    name: "RDB (Recibo de Depósito Bancário)",
    summary: "Título bancário semelhante ao CDB, porém intransferível",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender RDB diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por instituições menores."
}, {
    id: 23,
    category: "Renda Fixa - Privada Bancária",
    name: "RDC (Recibo de Depósito Cooperativo)",
    summary: "Recibo de Depósito Cooperativo emitido por cooperativas de crédito. CDB das Cooperativas.",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender RDC diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGCoop (Fundo Garantidor do Cooperativismo de Crédito), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por investidores."
}, {
    id: 19,
    category: "Renda Fixa - Privada Bancária",
    name: "LC (Letra de Câmbio)",
    summary: "Título emitido por financeiras",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LC diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por instituições menores."
}, {
    id: 18,
    category: "Renda Fixa - Privada Bancária",
    name: "LF (Letra Financeira)",
    summary: "Título bancário de médio/longo prazo, sem liquidez antes do vencimento e sem FGC.",
    taxPF: "IR regressivo (15% a 22,5%) (como o prazo mínimo é de 2 anos, na prática aplica-se a menor alíquota (15%) e não há incidência de IOF)",
    taxPJ: "IR regressivo (15% a 22,5%) (como o prazo mínimo é de 2 anos, na prática aplica-se a menor alíquota (15%) e não há incidência de IOF)",
    howToBuy: "Você pode comprar e vender LF diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título não conta com a proteção do FGC (Fundo Garantidor de Créditos). Assim, a segurança do investimento depende apenas da capacidade e da solidez da instituição financeira emissora."
}, {
    id: 6,
    category: "Renda Fixa - Privada Bancária",
    name: "LCI (Letra de Crédito Imobiliário)",
    summary: "Letra de Crédito Imobiliário.",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LCI diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por instituições menores."
}, {
    id: 24,
    category: "Renda Fixa - Privada Bancária",
    name: "LCA (Letra de Crédito do Agronegócio)",
    summary: "Letra de Crédito do Agronegócio.",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LCA diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por investidores."
}, {
    id: 25,
    category: "Renda Fixa - Privada Bancária",
    name: "LCD (Letra de Crédito do Desenvolvimento)",
    summary: "Letra de Crédito do Desenvolvimento, voltada ao financiamento de projetos de desenvolvimento",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LCD diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por investidores."
}, {
    id: 21,
    category: "Renda Fixa - Privada Bancária",
    name: "LIG (Letra Imobiliária Garantida)",
    summary: "Letra Imobiliária Garantida, título imobiliário com dupla garantia",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LIG diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de ativo não possui a cobertura do Fundo Garantidor de Créditos (FGC). No entanto, a LIG conta com um mecanismo de dupla garantia. A primeira é a garantia da própria instituição financeira emissora, responsável pelo pagamento do título. A segunda é uma carteira de créditos imobiliários segregada, que fica separada do patrimônio do banco. Dessa forma, mesmo em caso de falência da instituição financeira, esses ativos permanecem protegidos e podem ser utilizados para honrar o pagamento aos investidores."
}, {
    id: 26,
    category: "Renda Fixa - Privada Bancária",
    name: "LH (Letra Hipotecária)",
    summary: "Título lastreado em créditos imobiliários",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender LH (Letra Hipotecária) diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse título conta com a proteção do FGC (Fundo Garantidor de Créditos), que oferece cobertura de até R$ 250 mil por CPF ou CNP, por instituição financeira ou conglomerado financeiro. Além disso, existe um teto global de R$ 1 milhão a cada 4 anos, independentemente do número de instituições financeiras. Também é importante considerar a segurança da instituição emissora. Em geral, títulos emitidos por instituições de maior porte tendem a apresentar menor risco em comparação com aqueles emitidos por instituições menores."
}, {
    id: 7,
    category: "Renda Fixa - Crédito Privado",
    name: "CRI (Certificado de Recebíveis Imobiliários)",
    summary: "Certificado de Recebíveis Imobiliários, lastreado em créditos imobiliários",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender CRI diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a proteção do FGC (Fundo Garantidor de Créditos). Diferentemente dos títulos bancários, ele é emitido por securitizadoras, e não por bancos, o que faz com que não esteja coberto pela garantia do fundo. Como se trata de um investimento com maior nível de risco, costuma oferecer rendimentos isentos de Imposto de Renda para pessoas físicas, como forma de compensar esse risco adicional."
}, {
    id: 27,
    category: "Renda Fixa - Crédito Privado",
    name: "CRA (Certificado de Recebíveis do Agronegócio)",
    summary: "Certificado de Recebíveis do Agronegócio, lastreado em créditos do agronegócio",
    taxPF: "Isento de IR",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender CRA diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a proteção do FGC (Fundo Garantidor de Créditos). Diferentemente dos títulos bancários, ele é emitido por securitizadoras, e não por bancos, o que faz com que não esteja coberto pela garantia do fundo. Como se trata de um investimento com maior nível de risco, costuma oferecer rendimentos isentos de Imposto de Renda para pessoas físicas, como forma de compensar esse risco adicional."
}, {
    id: 28,
    category: "Renda Fixa - Crédito Privado",
    name: "COE (Certificado de Operações Estruturadas)",
    summary: "Certificado de Operações Estruturadas, combina renda fixa e derivativos",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender COE diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Em caso de falência ou quebra da instituição emissora, o investidor pode correr o risco de perder o capital investido, inclusive em COEs classificados como \"capital protegido\", já que essa proteção depende da capacidade de pagamento da emissora. São títulos ruins."
}, {
    id: 8,
    category: "Renda Fixa - Crédito Privado",
    name: "Debênture comum",
    summary: "Título de dívida emitido por empresas",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender Debênture comum diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Dessa forma, o investidor fica totalmente exposto à capacidade da empresa emissora de cumprir suas obrigações financeiras."
}, {
    id: 29,
    category: "Renda Fixa - Crédito Privado",
    name: "Debênture incentivada",
    summary: "Debênture voltada a projetos de infraestrutura",
    taxPF: "Isento de IR",
    taxPJ: "IR 15% (regra específica)",
    howToBuy: "Você pode comprar e vender Debênture incentivada diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Dessa forma, o investidor fica totalmente exposto à capacidade da empresa emissora de cumprir suas obrigações financeiras."
}, {
    id: 30,
    category: "Renda Fixa - Crédito Privado",
    name: "Debênture de infraestrutura",
    summary: "Debênture com benefícios fiscais para financiar infraestrutura. O benefício é para a empresa emissora, não para o investidor.",
    taxPF: "IR regressivo (15% a 22,5%)",
    taxPJ: "IR regressivo (15% a 22,5%)",
    howToBuy: "Você pode comprar e vender Debênture de infraestrutura diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Dessa forma, o investidor fica totalmente exposto à capacidade da empresa emissora de cumprir suas obrigações financeiras."
}, {
    id: 31,
    category: "Renda Fixa - Crédito Privado",
    name: "Debênture conversível/permutável",
    summary: "Debênture que pode ser convertida ou trocada por ações",
    taxPF: "Segue regime da debênture (comum, incentivada ou infra.)",
    taxPJ: "Segue regime da debênture (comum ou incentivada)",
    howToBuy: "Você pode comprar e vender Debênture conversível/permutável diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Dessa forma, o investidor fica totalmente exposto à capacidade da empresa emissora de cumprir suas obrigações financeiras."
}, {
    id: 32,
    category: "Renda Fixa - Crédito Privado",
    name: "Nota promissória",
    summary: "Título de dívida de curto prazo emitido por empresas",
    taxPF: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    taxPJ: "IR regressivo (15% a 22,5%) + IOF até 30 dias",
    howToBuy: "Você pode comprar e vender Nota promissória diretamente pela sua corretora.",
    costs: "Além dos impostos, podem existir custos relacionados a taxas e tarifas cobradas pela instituição financeira utilizada para comprar esses títulos.",
    risks: "O principal risco desses títulos é o risco do emissor, já que o investidor fica exposto ao risco de crédito, que é o risco de o emissor não cumprir suas obrigações de pagamento.",
    guarantees: "Esse tipo de título não conta com a garantia do Fundo Garantidor de Créditos (FGC). Dessa forma, o investidor fica totalmente exposto à capacidade da empresa emissora de cumprir suas obrigações financeiras."
}, {
    id: 9,
    category: "Renda Variável",
    name: "Ações Ordinárias - ON (final 3)",
    summary: "Ações que dão direito a voto nas assembleias da empresa.",
    taxPF: "20% sobre o lucro líquido, sem isenção por volume de vendas, pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 1% (dedo-duro) como IR Fonte, que pode ser compensado no pagamento do DARF.",
    taxPJ: "15% sobre o lucro líquido, com isenção se o total de vendas de ações for inferior a R$ 20.000 no mês. Pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 0,005% (dedo-duro) do valor da venda como IR Fonte, que pode ser compensado no pagamento da DARF.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em ações, o investidor fica exposto ao risco de mercado, que é o risco de variação nos preços das ações. Também está sujeito ao risco específico da empresa, relacionado a fatores internos, como decisões da gestão ou desempenho do negócio. Além disso, existe o risco sistemático, que afeta todo o mercado e pode ser causado por eventos econômicos ou geopolíticos, como crises, pandemias ou guerras. Por fim, há também o risco de liquidez, que é o risco de não conseguir vender o ativo rapidamente ou de precisar vendê-lo por um preço inferior ao esperado.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 33,
    category: "Renda Variável",
    name: "Ações Preferenciais - PN (final 4)",
    summary: "Ações que têm preferência no recebimento de dividendos e em caso de liquidação da empresa.",
    taxPF: "20% sobre o lucro líquido, sem isenção por volume de vendas, pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 1% (dedo-duro) como IR Fonte, que pode ser compensado no pagamento do DARF.",
    taxPJ: "15% sobre o lucro líquido, com isenção se o total de vendas de ações for inferior a R$ 20.000 no mês. Pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 0,005% (dedo-duro) do valor da venda como IR Fonte, que pode ser compensado no pagamento da DARF.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em ações, o investidor fica exposto ao risco de mercado, que é o risco de variação nos preços das ações. Também está sujeito ao risco específico da empresa, relacionado a fatores internos, como decisões da gestão ou desempenho do negócio. Além disso, existe o risco sistemático, que afeta todo o mercado e pode ser causado por eventos econômicos ou geopolíticos, como crises, pandemias ou guerras. Por fim, há também o risco de liquidez, que é o risco de não conseguir vender o ativo rapidamente ou de precisar vendê-lo por um preço inferior ao esperado.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 34,
    category: "Renda Variável",
    name: "Ações Units (final 11)",
    summary: "Um conjunto que combina ações ordinárias (ON – direito a voto) e preferenciais (PN – preferência em dividendos) da mesma empresa em um único ativo.",
    taxPF: "20% sobre o lucro líquido, sem isenção por volume de vendas, pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 1% (dedo-duro) como IR Fonte, que pode ser compensado no pagamento do DARF.",
    taxPJ: "15% sobre o lucro líquido, com isenção se o total de vendas de ações for inferior a R$ 20.000 no mês. Pago via DARF até o último dia útil do mês seguinte à operação. A corretora retém 0,005% (dedo-duro) do valor da venda como IR Fonte, que pode ser compensado no pagamento da DARF.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em ações units, o investidor fica exposto ao risco de mercado, que é o risco de variação nos preços das ações. Também está sujeito ao risco específico da empresa, relacionado a fatores internos, como decisões da gestão ou desempenho do negócio. Além disso, existe o risco sistemático, que afeta todo o mercado e pode ser causado por eventos econômicos ou geopolíticos, como crises, pandemias ou guerras. Por fim, há também o risco de liquidez, que é o risco de não conseguir vender o ativo rapidamente ou de precisar vendê-lo por um preço inferior ao esperado. No caso das units, a liquidez costuma ser maior do que a das ações ON ou PN negociadas separadamente.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 35,
    category: "Renda Variável",
    name: "BDRs (Brazilian Depositary Receipts)",
    summary: "São certificados negociados na bolsa brasileira (B3) que representam ações de empresas estrangeiras. Na prática, permitem que investidores brasileiros invistam em companhias globais — como Apple, Google, Amazon, McDonald's e Tesla — sem precisar abrir conta ou enviar dinheiro para o exterior.",
    taxPF: "A tributação de BDRs no Brasil incide sobre o lucro na venda e sobre os dividendos recebidos. Nas operações de compra e venda no mesmo dia, a alíquota é de 20% sobre o lucro líquido. Diferentemente das ações brasileiras, não existe isenção para vendas abaixo de R$ 20 mil por mês. Há também a retenção do chamado \"dedo-duro\", de 1,00% sobre o valor de venda em operações de compra e venda no mesmo dia. Os dividendos recebidos do exterior seguem a tabela progressiva do Imposto de Renda, podendo chegar a 27,5%, com possibilidade de compensação de eventual imposto pago no exterior. O investidor é responsável pelo cálculo e pagamento do imposto, por meio de DARF até o último dia útil do mês seguinte à venda com lucro.",
    taxPJ: "A tributação de BDRs no Brasil incide sobre o lucro na venda e sobre os dividendos recebidos. Nas operações de compra e venda em dias diferentes, a alíquota é de 15% sobre o lucro líquido. Diferentemente das ações brasileiras, não existe isenção para vendas abaixo de R$ 20 mil por mês. Há também a retenção do chamado \"dedo-duro\", de 0,005% sobre o valor de venda em operações de compra e venda em dias diferentes. Os dividendos recebidos do exterior seguem a tabela progressiva do Imposto de Renda, podendo chegar a 27,5%, com possibilidade de compensação de eventual imposto pago no exterior. O investidor é responsável pelo cálculo e pagamento do imposto, por meio de DARF até o último dia útil do mês seguinte à venda com lucro.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em BDRs, o investidor fica exposto ao risco de mercado, relacionado à variação no preço dos certificados negociados na bolsa. Também há o risco específico da empresa estrangeira à qual o BDR está vinculado, ligado a fatores internos como decisões da gestão, resultados financeiros ou mudanças no modelo de negócio. Além disso, existe o risco sistemático, que afeta todo o mercado e pode ser causado por eventos econômicos ou geopolíticos, como crises, pandemias ou guerras. Outro fator é o risco de liquidez, que representa a possibilidade de não conseguir vender os certificados rapidamente ou apenas a um preço inferior ao esperado. Por fim, há também o risco cambial, já que o valor dos BDRs é influenciado pela variação do câmbio entre o real e a moeda do país de origem da empresa, o que pode aumentar ou reduzir o retorno do investimento.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 10,
    category: "Renda Variável",
    name: "FIIs (Fundos de Investimentos Imobiliários)",
    summary: "São cotas de fundos que investem no setor imobiliário. Esses fundos podem investir, por exemplo, na construção e venda de imóveis ou na aquisição de imóveis para locação, como prédios comerciais, shoppings, galpões logísticos ou outros tipos de propriedades.",
    taxPF: "Os rendimentos dos FIIs são isentos de Imposto de Renda para pessoa física, desde que o fundo tenha pelo menos 100 cotistas, o investidor não possua mais de 10% das cotas e as cotas sejam negociadas em bolsa ou mercado de balcão organizado (B3). Propostas recentes indicam que cotas emitidas a partir de 2026 podem ter tributação de 5% sobre os rendimentos, enquanto cotas emitidas até 31/12/2025 manterão a isenção. Na venda de cotas com lucro, o imposto é de 20% sobre o ganho, sem faixa de isenção como nas ações. O pagamento deve ser feito via DARF até o último dia útil do mês seguinte. Para pessoas jurídicas, os rendimentos são tributados conforme o regime da empresa, com retenção na fonte geralmente de 20%, podendo ser compensada com o IRPJ devido.",
    taxPJ: "Na venda de cotas com lucro, o imposto é de 20% sobre o lucro. Diferentemente das ações brasileiras, não existe isenção para vendas abaixo de R$ 20 mil por mês. Há também a retenção do chamado \"dedo-duro\", de 1,00% sobre o valor de venda em operações de compra e venda no mesmo dia.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em FIIs, o investidor fica exposto ao risco de mercado, relacionado à variação no preço das cotas. Também existe o risco específico do fundo, ligado a fatores como vacância dos imóveis ou decisões do gestor. Além disso, há o risco sistemático, que afeta todo o mercado e pode ser causado por eventos como crises, pandemias ou guerras, e o risco de liquidez, que é a dificuldade de vender as cotas rapidamente ou por um preço justo. No entanto, os FIIs costumam apresentar menor risco de liquidez quando comparados a ações.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 11,
    category: "Renda Variável",
    name: "ETFs (Exchange Traded Funds)",
    summary: "São fundos negociados na bolsa de valores (B3) que buscam replicar índices de mercado (como Ibovespa ou S&P 500) por meio de gestão passiva. Eles permitem diversificação rápida e baixo custo, geralmente com taxas de administração menores que as de fundos ativos. Suas carteiras podem incluir ações, renda fixa ou criptoativos.",
    taxPF: "Nos ETFs, operações de compra e venda em dias diferentes são tributadas à alíquota de 15% sobre o lucro. Diferentemente das ações, não existe a faixa de isenção de R$ 20 mil em vendas. Para ETFs de renda fixa, a tributação é de 15% sobre o lucro, pois geralmente possuem prazo médio superior a 720 dias. No Brasil, a maioria dos ETFs reinveste os dividendos em vez de distribuí-los, o que evita incidência de imposto na fonte; quando há distribuição, a tributação segue as regras aplicáveis a fundos. O cálculo e o recolhimento do imposto, por meio de DARF, são de responsabilidade do investidor.",
    taxPJ: "Nos ETFs, operações de compra e venda no mesmo dia são tributadas à alíquota de 20% sobre o lucro. Diferentemente das ações, não existe a faixa de isenção de R$ 20 mil em vendas. Para ETFs de renda fixa, a tributação é de 15% sobre o lucro, pois geralmente possuem prazo médio superior a 720 dias. No Brasil, a maioria dos ETFs reinveste os dividendos em vez de distribuí-los, o que evita incidência de imposto na fonte; quando há distribuição, a tributação segue as regras aplicáveis a fundos. O cálculo e o recolhimento do imposto, por meio de DARF, são de responsabilidade do investidor.",
    howToBuy: "Diretamente pelo Home Broker da sua corretora. Pode ser pelo celular ou pelo computador.",
    costs: "Pode haver taxas dependendo da sua corretora. Ela pode cobrar taxas de corretagem para compra e venda e também taxa de custódia. Vale a pena verificar quais são os custos dessa operação na sua corretora.",
    risks: "Ao investir em ETFs, o investidor fica exposto ao risco de mercado, relacionado à variação no preço das cotas. Também existe o risco específico do fundo, ligado à composição da carteira e às decisões do gestor. Além disso, há o risco sistemático, que afeta todo o mercado e pode ser causado por eventos como crises, pandemias ou guerras, e o risco de liquidez, que é a dificuldade de vender as cotas rapidamente ou por um preço justo. No entanto, os ETFs costumam apresentar menor risco de liquidez quando comparados a ações individuais.",
    guarantees: "Não possuem garantias formais, como no caso de títulos bancários que contam com a proteção do FGC. Também não há garantia de resultados."
}, {
    id: 12,
    category: "Criptoativos",
    name: "BTC (Bitcoin)",
    summary: "Ativo digital descentralizado e escasso (limite de 21 milhões), utilizado como postulante a reserva de valor.",
    taxPF: "15% sobre o lucro líquido. Isenção para vendas totais até R$ 35 mil/mês (apenas para exchanges nacionais).",
    taxPJ: "Diferente dos ativos da B3 (Ações, FIIs), as criptomoedas não são reguladas pela CVM no que tange à garantia de ativos, embora as corretoras devam reportar movimentações à Receita Federal (IN 1.888).",
    howToBuy: "Corretoras/exchanges, plataformas bancárias e via P2P.",
    costs: "Taxas de corretagem cobradas pela exchange na compra e venda. Para transferências para carteiras particulares, incide a Taxa de Rede (Network Fee), que varia conforme o congestionamento da rede blockchain no momento da transação.",
    risks: "Risco de mercado e volatilidade extrema. Sujeito a variações bruscas de preço 24/7 e risco de perda das chaves privadas.",
    guarantees: "Não possui garantias formais nem proteção do FGC. A segurança depende da criptografia da rede e da custódia do investidor."
}, {
    id: 14,
    category: "Criptoativos",
    name: "Stablecoins (ex.: USDT, USDC, etc.)",
    summary: "Criptoativos pareados em moedas estáveis (geralmente o Dólar), servindo como ponte de liquidez e proteção cambial.",
    taxPF: "IOF de 3,5%.",
    taxPJ: "Diferente dos ativos da B3 (Ações, FIIs), as criptomoedas não são reguladas pela CVM no que tange à garantia de ativos, embora as corretoras devam reportar movimentações à Receita Federal (IN 1.888).",
    howToBuy: "Corretoras/exchanges e plataformas bancárias.",
    costs: "Semelhante ao Bitcoin, incidem taxas de corretagem.",
    risks: "Risco de desaparecimento e risco de crédito da emissora da stablecoin (solidez das reservas).",
    guarantees: "Não possui proteção do FGC. A segurança reside na transparência das auditorias das reservas da empresa emissora."
}, {
    id: 13,
    category: "Criptoativos",
    name: "Altcoins (ex.: Ethereum, Solana, etc.)",
    summary: "Criptoativos de redes que permitem contratos inteligentes e aplicações descentralizadas (DeFi, NFTs).",
    taxPF: "15% sobre o lucro líquido. Alíquotas maiores (até 22,5%) podem incidir sobre ganhos de capital milionários.",
    taxPJ: "Diferente dos ativos da B3 (Ações, FIIs), as criptomoedas não são reguladas pela CVM no que tange à garantia de ativos, embora as corretoras devam reportar movimentações à Receita Federal (IN 1.888).",
    howToBuy: "Corretoras/exchanges, plataformas bancárias e via P2P.",
    costs: "Taxas de corretagem cobradas pela exchange na compra e venda. Para transferências para carteiras particulares, incide a Taxa de Rede (Network Fee), que varia conforme o congestionamento da rede blockchain no momento da transação.",
    risks: "Risco tecnológico e de projeto. Além da volatilidade, há o risco de falhas em protocolos ou falta de adoção.",
    guarantees: "Inexistentes. Não possuem qualquer garantia de resultados ou proteção contra perdas. Em caso de falha do projeto, o investidor não tem a quem recorrer judicialmente."
}] as const satisfies readonly AssetCatalogSeedItem[];
