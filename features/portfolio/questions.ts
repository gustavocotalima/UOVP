export const DEFAULT_QUESTIONS = [
  { type: "CERRADO", criterion: "ROE", text: "ROE historicamente maior que 5%? (Considere anos anteriores)." },
  { type: "CERRADO", criterion: "CAGR", text: "Tem um crescimento de receitas (Ou lucro) superior a 5% nos últimos 5 anos?" },
  { type: "CERRADO", criterion: "DIVIDENDOS", text: "A empresa tem um histórico de pagamento de dividendos?" },
  { type: "CERRADO", criterion: "TECNOLOGIA E PESQUISA", text: "A empresa investe amplamente em pesquisa e inovação? Setor Obsoleto = SEMPRE NÃO" },
  { type: "CERRADO", criterion: "TEMPO DE MERCADO", text: "Tem mais de 30 anos de mercado? (Fundação)" },
  { type: "CERRADO", criterion: "VANTAGENS COMPETITIVAS", text: "É líder nacional ou mundial no setor em que atua? (Só considera se for LÍDER, primeira colocada)" },
  { type: "CERRADO", criterion: "PERENIDADE", text: "O setor em que a empresa atua tem mais de 100 anos?" },
  { type: "CERRADO", criterion: "TAMANHO", text: "A empresa é uma BLUE CHIP?" },
  { type: "CERRADO", criterion: "GOVERNANÇA", text: "A empresa tem uma boa gestão? Histórico de corrupção = SEMPRE NÃO" },
  { type: "CERRADO", criterion: "INDEPENDÊNCIA", text: "É livre de controle ESTATAL ou concentração em cliente único?" },
  { type: "CERRADO", criterion: "POUCO ENDIVIDADA", text: "Nos últimos 5 anos, a Div. Líquida/EBITDA é menor que 2 ou o Indice de Basileia maior que 14 para banco?" },
  { type: "REAL_ESTATE", criterion: "Localização", text: "Os imóveis desse Fundo Imobiliário estão localizados em regiões nobres?" },
  { type: "REAL_ESTATE", criterion: "Propriedades", text: "As propriedades são novas e não consomem manutenção excessiva?" },
  { type: "REAL_ESTATE", criterion: "P/VP", text: "O fundo imobiliário está negociado abaixo do P/VP 1? (Acima de 1,5, eu descarto o investimento em qualquer hipótese)" },
  { type: "REAL_ESTATE", criterion: "Dividendos", text: "Distribui dividendos a mais de 4 anos consistentemente?" },
  { type: "REAL_ESTATE", criterion: "Dependência", text: "Não é dependende de um único inquilino ou imóvel?" },
  { type: "REAL_ESTATE", criterion: "Setor", text: "O Yield está dentro ou acima da média para fundos imobiliários do mesmo tipo?" },
  { type: "REAL_ESTATE", criterion: "Vacancia", text: "A vacância dos imóveis está abaixo de 5%" },
] as const;

export function calculateDiagramScore(answers: boolean[]) {
  return answers.reduce((score, answer) => score + (answer ? 1 : -1), 0);
}
