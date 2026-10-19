# Valance OS

Plataforma de gestão comercial e relacionamento com clientes. Reúne agendas de atendimento, distribuição de contatos, acompanhamento de vendas e relatórios de desempenho em uma interface responsiva.

O projeto busca facilitar a rotina de vendedores e gestores, organizando as oportunidades de contato e oferecendo uma visão dos resultados da equipe e da loja.

## Funcionalidades

### Atendimento e relacionamento

- Agendas de pós-venda, aniversariantes, reativação, campanhas e boas-vindas.
- Registro individual de atendimentos e conclusão das agendas.
- Distribuição equilibrada de contatos entre vendedores, com prévia e histórico.
- Abertura de conversas no WhatsApp a partir de um número com DDD ou código internacional.
- Exibição e cópia do link da conversa como alternativa à abertura direta.

### Vendas e indicadores

- Visão geral com indicadores, gráfico de vendas e ranking da equipe.
- Painel de vendas com meta, conversão e comparativos.
- Painel da loja com participação por canal, ticket médio, peças por atendimento e desempenho dos vendedores.
- Relatório Real Time com projeções, ranking e comparativo de 364 dias.

### Relatórios

- **Gerou por agenda:** resultados e atribuições de receita por agenda ou vendedor.
- **Gerou por loja:** consolidação dos resultados da unidade.
- **Dedo Duro:** acompanhamento dos contatos atribuídos, realizados e pendentes por vendedor.
- Filtros de período, agenda, vendedor e, nos relatórios comerciais, canal e valor mínimo da venda.
- Indicadores expansíveis, ordenação de tabelas e exportação dos resultados filtrados em CSV e Excel (`.xlsx`).

### Equipe e navegação

- Consulta e edição de vendedores, cupons e acessos demonstrativos.
- Compartilhamento da lista de vendedores e de credenciais fictícias.
- Busca global por telas, recursos, vendedores, CPF, cupons e contatos.
- Menu Workspace recolhível, temas claro e escuro e edição de perfil.
- Relógio local e saudação automática conforme o horário do dispositivo.

## Tecnologias

| Tecnologia | Uso |
| --- | --- |
| JavaScript com módulos ES | Lógica da aplicação e interações |
| HTML e CSS | Estrutura, estilos e layout responsivo |
| Vite | Servidor de desenvolvimento e build |
| Lucide | Ícones da interface |
| DM Sans e Manrope | Fontes incluídas no projeto |
| fflate | Compactação dos arquivos de exportação Excel |
| Node.js Test Runner | Testes automatizados |
| localStorage | Persistência dos dados no navegador |

## Requisitos

- Node.js 20.19+ ou 22.12+.
- npm.
- Navegador atualizado, como Chrome, Edge ou Firefox.

## Instalação

```bash
git clone https://github.com/GFaria0101/Valance-OS.git
cd Valance-OS
npm ci
```

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

Abra o endereço informado no terminal e selecione **Entrar na demonstração**.

## Comandos disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento |
| `npm test` | Executa os testes automatizados |
| `npm run build` | Gera a versão de produção na pasta `dist` |
| `npm run preview` | Disponibiliza uma prévia local do build |

Para visualizar o build localmente:

```bash
npm run build
npm run preview
```

A pasta `dist` pode ser hospedada em um serviço de sites estáticos.

## Como usar

1. Entre na demonstração e abra o Workspace pelo botão com o nome do utilizador.
2. Em **Distribuir contatos**, escolha a agenda, a quantidade e os vendedores participantes. Confira a prévia e confirme a distribuição.
3. Em **Agendas do dia**, registre os atendimentos ou conclua uma agenda. Os registros atualizam o relatório **Dedo Duro**.
4. Acompanhe os resultados nos painéis e utilize os filtros dos relatórios para consultar e exportar os dados.
5. Para iniciar uma conversa, clique em **WhatsApp** no cabeçalho, informe o número e confirme a abertura.

A busca global também pode ser aberta com `Ctrl+K` ou `Cmd+K`. O relógio e a saudação acompanham o horário do dispositivo, sem necessidade de recarregar a página.

## Estrutura do projeto

```text
Valance-OS/
├── index.html
├── package.json
├── package-lock.json
├── src/
│   ├── main.js            # Inicialização, navegação e telas principais
│   ├── features.js        # Relatórios, distribuição e gestão de contatos
│   ├── header-tools.js    # WhatsApp, busca global, relógio e saudação
│   ├── report-data.js     # Dados comerciais, filtros e comparativos
│   ├── export.js          # Exportações CSV e Excel
│   └── style.css          # Estilos, temas e responsividade
└── tests/
    ├── data.test.js
    └── header-tools.test.js
```

## Estado atual

Esta versão é uma demonstração funcional de frontend, com dados fictícios. Não possui backend, autenticação real ou integração com uma base comercial de produção. As credenciais geradas não concedem acesso a outros sistemas.

Os relatórios comerciais incluem vendas simuladas de **1 a 18 de outubro de 2026** e um histórico comparável de 2025. Consultas fora desse intervalo podem não apresentar resultados. As proporções de atribuição de receita e as projeções são ilustrativas.

Os contatos, as distribuições e as alterações da equipe são salvos em `localStorage`. Esses dados permanecem no navegador utilizado e não são sincronizados entre dispositivos. Os registros de atendimento atualizam os controles locais; as vendas dos relatórios pertencem a uma base simulada independente.

O WhatsApp é aberto por um link externo. A escolha do destinatário e o envio de mensagens ficam a cargo do utilizador. Algumas prévias de arquivos podem impedir a abertura de links externos; nesses casos, abra o projeto em um navegador ou utilize a opção de copiar o link.

Para reiniciar a demonstração, remova do armazenamento local do navegador as entradas com os prefixos `valance-` e `contact-`. Sair da conta não apaga os dados salvos.

## Testes

Os testes cobrem filtros e totais dos relatórios, comparação de 364 dias, distribuição de contatos, estrutura dos arquivos Excel, validação de telefones, busca global e limites de horário das saudações.

```bash
npm test
```
