# Valance OS

Sistema demonstrativo de gestão de relacionamento e vendas, em português, com navegação responsiva, dados fictícios e visual inspirado nas referências fornecidas. JavaScript, Vite, Lucide e fontes locais.

## Executar

Requer Node.js 20.19+ ou 22.12+.

```sh
npm ci --cache /workspace/.npm-cache
npm run dev -- --port 5173
```

Escolha **Entrar na demonstração**. O formulário de login também aceita uma identificação fictícia e uma senha fictícia com pelo menos quatro caracteres. Não use credenciais reais.

```sh
npm test
npm run build
npm run preview -- --port 4173
```

## Cabeçalho e horário

- O botão compacto **WhatsApp** abre um popup com o campo **DDD + número**. Ao confirmar, abre `wa.me` na mesma aba para o número digitado, sem depender de uma nova janela. Há também um link direto de alternativa, sem salvar o telefone. Aceita número brasileiro com DDD (assume +55) e internacional com `+` e código do país. A conversa é iniciada pelo utilizador no WhatsApp; não há envio automático.
- A **lupa** (também `Ctrl+K` / `Cmd+K`) pesquisa telas, recursos, nomes de vendedores, CPF, cupons, agendas e contatos locais. Os resultados abrem a tela correspondente ou o vendedor/agenda encontrado. A busca não consulta a internet.
- O **relógio** atualiza a cada segundo usando o horário e o fuso do dispositivo. A saudação muda sem recarregar: bom dia das 05h às 11h59, boa tarde das 12h às 17h59 e boa noite das 18h às 04h59. O horário real é independente das datas fictícias dos relatórios.

## Telas e funções

O botão com o nome do utilizador e o ícone de menu abre o Workspace, oculto por padrão no computador e no celular.

- **Visão geral e painel de vendas:** indicadores, gráficos e ranking.
- **Agendas:** contatos, responsável, registro individual ou conclusão em lote. Quando todos os contatos estiverem realizados, apresenta “Tudo concluído por hoje” e a próxima abertura. Ao registrar um contato ainda sem responsável, ele é atribuído ao primeiro vendedor da demonstração.
- **Distribuir contatos:** escolhe agenda, quantidade e vendedores ativos; gera uma prévia equilibrada antes de confirmar. Preserva contatos já atribuídos e mantém histórico local.
- **Gerou por agenda:** datas personalizadas, filtros de agenda, vendedor, canal e venda mínima; indicadores expansíveis, agrupamento por agenda/vendedor, ordenação, SSS e atribuições de receita por agenda, loja e vendedor. Exporta os resultados filtrados como CSV ou Excel `.xlsx` real.
- **Gerou por loja:** consolida os resultados da loja com os mesmos filtros e exportações. A demonstração contém uma loja, Reserva Downtown.
- **Dedo Duro:** acompanha os contatos efetivamente distribuídos e registrados neste navegador: disponíveis preferenciais, feitos, percentual, Gotas e total. Inicialmente os contatos estão livres para distribuição. Filtros de período, agenda, vendedor e situação.
- **Real Time:** tabelas completas de loja e vendedores, ranking e comparativo fixo de 364 dias, que mantém os mesmos dias da semana do ano anterior. Projeção mensal ilustrativa baseada no corte de 18/10 e no mês de 31 dias.
- **Painel da loja:** meta mensal, vendas por canal/dia, ticket médio, peças por atendimento, conversão e desempenho por vendedor, com filtros e exportação.
- **Vendedores:** busca, filtros, edição, acessos, cupons, geração de credenciais demonstrativas, compartilhamento da lista filtrada sem CPF/senhas e prévia para abrir o WhatsApp com o acesso fictício.
- **Perfil e temas:** edição de perfil, tema claro e escuro.

Os relatórios comerciais usam vendas simuladas de **1 a 18 de outubro de 2026**, com histórico comparável de 2025. Datas fora desse período podem não conter vendas. A conclusão das agendas informa a próxima abertura na data de demonstração, 19/10/2026 às 10h de Brasília; não há agendamento por servidor. Os contatos e o Dedo Duro refletem as ações locais, enquanto as vendas são uma base fictícia independente dessas ações.

O SSS é `(receita atual / receita comparável - 1) × 100`; sem base anterior, apresenta “Sem base”. “Gerou agenda” e “Gerou loja” dividem o total em 23% e 77%. “Gerou vendedor” é uma atribuição de 29% do mesmo total, não uma receita adicional. As proporções são ilustrativas. OFF representa os canais físicos; ON/CDIG representa o canal digital.

## Persistência e compartilhamento

Dados e alterações ficam em `localStorage`, somente no navegador atual. O sistema não possui backend, autenticação real, redefinição de senha por servidor ou atualização automática das vendas. Para buscar um vendedor, use por exemplo o CPF fictício `52998224725`. “Adicionar vendedor” simula localizar e ativar um membro já cadastrado na equipe.

O WhatsApp abre uma mensagem de demonstração para o utilizador escolher o destinatário e confirmar o envio. Nenhuma mensagem é enviada automaticamente. O compartilhamento de relatórios copia os dados filtrados; a lista de vendedores também permite compartilhamento nativo quando suportado e download CSV. Credenciais demonstrativas não dão acesso a sistemas reais.

Para reiniciar os dados, remova no armazenamento local as entradas com prefixo `valance-` e `contact-`. Fechar a sessão não apaga os contatos ou as alterações da equipe.

## Verificação

`npm test` valida filtros, totais, comparação de 364 dias, distribuição sem duplicação e o conteúdo do arquivo XLSX. Os fluxos também foram exercitados com Playwright/Chromium: filtros e estados vazios, exportações, distribuição/persistência, registros/Dedo Duro, conclusão das agendas, compartilhamento, abertura simulada do WhatsApp e layout móvel.
