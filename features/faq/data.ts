export const FAQ_SEED = [
  {
    slug: "carteira",
    title: "Minha carteira",
    items: [
      { question: "Como o Diagrama sugere seus aportes? (Guia Rápido)", answer: "O Diagrama considera suas metas por classe, a composição atual e a nota de cada ativo. Ele prioriza as maiores lacunas e respeita o preço e a divisibilidade de cada investimento." },
      { question: "Como faço alterações cadastrais?", answer: "Use o menu de perfil para revisar os dados disponíveis da conta." },
      { question: "Existe algum custo para manter a minha conta ou usar as ferramentas?", answer: "A política de acesso pode ser configurada pelo administrador da aplicação." },
      { question: "Posso criar mais de um usuário na carteira?", answer: "Sim. Cada usuário possui uma conta e dados financeiros totalmente isolados." },
      { question: "Como adicionar ativos?", answer: "Abra Carteira, selecione Ativos e use Adicionar ativo ou Importar XLSX." },
      { question: "Posso colocar a quantidade 0 no ativo?", answer: "Sim. O ativo permanece cadastrado e pode receber sugestões quando possuir nota positiva." },
      { question: "Ativos sem nota recebem indicação de aporte?", answer: "Não. Eles continuam nos totais da carteira, mas não recebem sugestão de aporte." },
      { question: "O que fazer quando não encontrar um ativo?", answer: "Cadastre o ativo manualmente e informe seu preço ou valor atual." },
      { question: "A simulação envia a ordem para uma corretora?", answer: "Não. A versão atual registra o aporte somente nesta aplicação." },
      { question: "Como inserir o Diagrama do Cerrado?", answer: "Use a seção Perguntas para restaurar o modelo e responder ao questionário por ativo." },
      { question: "Posso criar novas perguntas para o Diagrama?", answer: "Sim. Perguntas criadas pelo usuário ficam disponíveis apenas em sua própria conta." },
      { question: "Como realizar o aporte?", answer: "Simule um valor, revise os itens e confirme uma linha ou use Aportar tudo." },
      { question: "O que fazer se a sugestão não aparecer?", answer: "Confira se as metas somam 100%, se há preço e se pelo menos um ativo possui nota positiva." },
    ],
  },
  {
    slug: "orcamento",
    title: "Orçamento Doméstico",
    items: [
      { question: "Como cadastrar minhas metas?", answer: "Abra Minhas metas, ajuste as seis categorias até totalizar 100% e salve." },
      { question: "Como deixar meus custos salvos e realizar backup no mês seguinte?", answer: "Marque o gasto como recorrente e use Preencher no mês seguinte." },
      { question: "Como acompanhar meu orçamento?", answer: "A tabela mensal compara o gasto realizado com o valor-alvo de cada categoria." },
    ],
  },
  {
    slug: "ferramentas",
    title: "Ferramentas",
    items: [
      { question: "Como acessar a ferramenta de primeiro milhão?", answer: "Abra Ferramentas e selecione Primeiro milhão." },
      { question: "Para que serve a ferramenta de primeiro milhão?", answer: "Ela projeta o valor futuro do investimento para diferentes aportes e horizontes." },
      { question: "Para que serve a ferramenta de ativos e passivos?", answer: "Ela calcula seu patrimônio líquido a partir do total de ativos menos o total de passivos." },
      { question: "Como acessar a ferramenta ativos e passivos?", answer: "Abra Ferramentas e selecione Ativos vs Passivos." },
    ],
  },
] as const;
