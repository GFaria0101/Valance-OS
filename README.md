# Valance OS

Plataforma de gestão comercial e relacionamento com clientes para quiosques. Reúne agendas, distribuição de contatos, vendas, relatórios e gestão de equipe em uma interface responsiva.

## Arquitetura

- **Frontend:** JavaScript, Vite, HTML e CSS, com ícones Lucide e fontes locais.
- **Autenticação e dados:** Supabase Auth e PostgreSQL, com políticas RLS por organização, quiosque e utilizador.
- **Backend:** Netlify Functions para convites, administração de acesso e importação de dados.
- **Atualização compartilhada:** Supabase Realtime invalida as consultas quando os registros autorizados mudam.
- **Exportação:** CSV e Excel `.xlsx`.
- **Testes:** Node.js, PostgreSQL/PGlite e interface com Playwright.

A demonstração e a aplicação autenticada são modos separados. O ambiente de produção não utiliza os cadastros fictícios nem o login da demonstração.

## Funcionalidades do ambiente autenticado

- Login por e-mail e senha, convites e recuperação de acesso.
- Administrador com acesso aos quiosques da própria empresa.
- Gerente restrito ao próprio quiosque e vendedor restrito aos dados autorizados da sua carteira.
- Clientes, agendas e registros manuais de atendimento.
- Geração de tarefas e distribuição transacional entre vendedores do mesmo quiosque.
- Bloqueio de novos contatos para clientes que solicitaram não receber atendimento.
- Metas mensais da loja e dos vendedores.
- Vendas brutas antes de descontos, devoluções separadas e comparativo de 364 dias.
- Relatórios por vendedor, agenda, dia e quiosque, incluindo atribuição ao último contato válido em até 15 dias.
- Dedo Duro com contatos preferenciais, Gotas e totais realizados.
- Busca, abertura de conversa no WhatsApp e relógio com saudação conforme o horário local.
- Importação CSV de clientes e vendas, validada no servidor e confirmada atomicamente no banco.
- Auditoria de alterações e desativação de acesso preservando o histórico.

A confirmação de atendimento no WhatsApp é manual. Abrir uma conversa não comprova o envio, a entrega ou a leitura de mensagens.

## Estado da implantação

O repositório contém a implementação do backend, as migrações e a configuração do Netlify. **Isso não cria automaticamente um projeto Supabase ou um site Netlify.** A implantação depende de configurar os serviços, aplicar a migração, criar o administrador e validar o ambiente real.

A API oficial do Presence ainda não está integrada. O caminho disponível é importar arquivos CSV no formato documentado. Depois de confirmada a importação, os usuários conectados recebem as atualizações internas. Isso não representa uma consulta automática ao PDV.

A rotina agendada reservada à integração retorna estado bloqueado enquanto o adaptador oficial não existir; não importa dados nem altera cadastros. Backups, SMTP, domínio e testes de restauração devem ser configurados na infraestrutura proprietária.

Os campos de canais de venda e o histórico de devoluções por data dependem dos dados disponibilizados pela origem; não são preenchidos com proporções fictícias.

## Executar a demonstração

Requer Node.js 22.12+ e npm.

```bash
npm ci
npm run dev:demo
```

A demonstração usa dados fictícios e armazenamento local. Ela não conecta contas ou dados reais. Para gerar seu build:

```bash
npm run build:demo
```

## Configurar a aplicação autenticada

1. Crie os projetos na conta proprietária e siga [o guia de implantação](docs/deploy.md).
2. Aplique [a migração do banco](supabase/migrations/202610250001_initial.sql).
3. Convide o primeiro administrador no Supabase Auth e execute o [bootstrap revisado](supabase/bootstrap.sql).
4. Configure as variáveis públicas do frontend e os segredos exclusivos das funções, conforme [.env.example](.env.example).
5. Configure SMTP e os endereços de convite/recuperação.
6. Publique pelo Netlify e execute a homologação de permissões, convites, importações e Realtime.

```bash
npm run dev
npm run build
```

O build de produção exige `VITE_APP_MODE=production`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Sem os valores obrigatórios, ele falha. A chave administrativa nunca deve ser configurada em uma variável `VITE_`.

O Vite atende o frontend local. As funções de administração exigem Netlify Functions, disponíveis via `netlify dev` ou no ambiente de homologação.

## Importar dados

Leia [o formato dos arquivos CSV](docs/importacao.md). O administrador ou gerente pode baixar os modelos pela aplicação, cadastrar os códigos de vendedor do PDV e importar os arquivos para o quiosque autorizado.

Clientes e vendas são reconhecidos pelo identificador externo dentro de cada quiosque. Importar novamente um registro atualiza seus dados, sem criar outra venda. O lote é desfeito se algum registro for inválido.

A carteira é recalculada pela última compra válida no próprio quiosque. As regras de operação e os limites da informação de origem estão detalhados em [Banco de dados](supabase/README.md).

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev:demo` | Demonstração local com dados fictícios |
| `npm run dev` | Frontend conectado ao Supabase configurado |
| `npm test` | Testes de banco, permissões, funções e regras |
| `npm run test:ui` | Interface de produção com serviços simulados de teste |
| `npm run build` | Build de produção com validação de configuração |
| `npm run build:demo` | Build explícito da demonstração |
| `npm run preview` | Prévia local de um build |

Os testes de interface usam Chromium em `/usr/bin/chromium` ou no caminho indicado por `CHROMIUM_PATH`. Eles geram um build isolado com configuração fictícia de teste, não publicam arquivos e não acessam um projeto remoto.

## Estrutura

```text
src/
  main.js                 Seleção segura do modo de execução
  production-app.js       Interface autenticada e operações reais
  app-config.js           Validação da configuração pública
  import-csv.js           Leitura dos arquivos de importação
  demo-app.js             Demonstração independente
  features.js             Funcionalidades da demonstração
  header-tools.js         Busca, telefone e regras de saudação
  export.js               CSV e Excel
netlify/functions/        API autenticada e rotina de integração
supabase/                 Migrações, bootstrap e regras de acesso
tests/                    Testes de dados, funções e segurança
scripts/                  Validação de build e teste da interface
docs/                     Implantação e importação
```

## Validação e operação

Os testes locais exercitam isolamento entre empresas/quiosques, bloqueio anônimo, proteção de funções, distribuição atômica, importação idempotente, desativação, atribuição de vendas e proteção de dados entre sessões.

A homologação em Supabase e Netlify reais permanece necessária para validar Auth, e-mails, PostgREST, Realtime, horários de execução e configurações de infraestrutura. Consulte o checklist em [Implantação](docs/deploy.md) antes de liberar a equipe.
