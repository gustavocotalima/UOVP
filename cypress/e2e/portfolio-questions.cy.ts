const cerradoQuestions = [
  ["ROE", "ROE historicamente maior que 5%? (Considere anos anteriores)."],
  ["CAGR", "Tem um crescimento de receitas (Ou lucro) superior a 5% nos últimos 5 anos?"],
  ["DIVIDENDOS", "A empresa tem um histórico de pagamento de dividendos?"],
  ["TECNOLOGIA E PESQUISA", "A empresa investe amplamente em pesquisa e inovação? Setor Obsoleto = SEMPRE NÃO"],
  ["TEMPO DE MERCADO", "Tem mais de 30 anos de mercado? (Fundação)"],
  ["VANTAGENS COMPETITIVAS", "É líder nacional ou mundial no setor em que atua? (Só considera se for LÍDER, primeira colocada)"],
  ["PERENIDADE", "O setor em que a empresa atua tem mais de 100 anos?"],
  ["TAMANHO", "A empresa é uma BLUE CHIP?"],
  ["GOVERNANÇA", "A empresa tem uma boa gestão? Histórico de corrupção = SEMPRE NÃO"],
  ["INDEPENDÊNCIA", "É livre de controle ESTATAL ou concentração em cliente único?"],
  ["POUCO ENDIVIDADA", "Nos últimos 5 anos, a Div. Líquida/EBITDA é menor que 2 ou o Indice de Basileia maior que 14 para banco?"],
] as const;

const realEstateQuestions = [
  ["Localização", "Os imóveis desse Fundo Imobiliário estão localizados em regiões nobres?"],
  ["Propriedades", "As propriedades são novas e não consomem manutenção excessiva?"],
  ["P/VP", "O fundo imobiliário está negociado abaixo do P/VP 1? (Acima de 1,5, eu descarto o investimento em qualquer hipótese)"],
  ["Dividendos", "Distribui dividendos a mais de 4 anos consistentemente?"],
  ["Dependência", "Não é dependende de um único inquilino ou imóvel?"],
  ["Setor", "O Yield está dentro ou acima da média para fundos imobiliários do mesmo tipo?"],
  ["Vacancia", "A vacância dos imóveis está abaixo de 5%"],
] as const;

function expectVisibleQuestions(expected: ReadonlyArray<readonly [string, string]>) {
  cy.get("section:not([hidden]) table tbody tr")
    .should("have.length", expected.length)
    .each(($row, index) => {
      const cells = $row.find("td");
      expect(cells.eq(0).text().trim()).to.eq(expected[index][0]);
      expect(cells.eq(1).text().trim()).to.eq(expected[index][1]);
    });
}

describe("perguntas padrão da carteira", () => {
  beforeEach(() => {
    cy.registerAndLogin();
    cy.visit("/carteira");
    cy.contains("button", "Perguntas").click();
  });

  it("cria novos usuários com os dois modelos copiados da conta AUVP", () => {
    expectVisibleQuestions(cerradoQuestions);

    cy.contains('[role="tab"]', "Investimentos imobiliários").click();
    expectVisibleQuestions(realEstateQuestions);
  });

  it("restaura o modelo imobiliário completo e na ordem original", () => {
    cy.contains('[role="tab"]', "Investimentos imobiliários").click();
    cy.contains("button", "Restaurar padrões").click();
    cy.get('[role="dialog"]').contains("button", "Sim").click();
    cy.contains('[role="status"]', "Modelo de perguntas aplicado.").should("be.visible");

    expectVisibleQuestions(realEstateQuestions);
  });
});
