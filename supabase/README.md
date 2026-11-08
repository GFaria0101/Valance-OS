# Banco de dados do Valance OS

O banco usa Supabase Auth + PostgreSQL. As regras de acesso são verificadas pelo próprio banco, inclusive quando um utilizador faz consultas fora da interface.

## Aplicar

Use um projeto Supabase dedicado. Aplique os arquivos de `migrations/` na ordem do nome, com o runner de migrações Supabase ou pelo editor SQL com uma conta administrativa. A inicial, `202610250001_initial.sql`, cria apenas a estrutura e as regras, sem usuários, senhas ou informações comerciais fictícias. `202611070001_report_details.sql` amplia os agregados dos relatórios e preserva as permissões. `202611070002_team_administrators.sql` mantém os administradores da empresa na lista de equipe ao selecionar um quiosque, respeitando a visibilidade definida pela RLS. `202611070003_staff_roles.sql` permite administrar funções e transferências preservando o histórico comercial.

1. Aplique todas as migrações, na ordem.
2. Em **Authentication → Users**, convide o proprietário usando o e-mail real dele. Não use inscrição pública para provisionar equipes.
3. Edite o e-mail e os nomes da empresa e dos dois quiosques em `bootstrap.sql` e execute-o no editor SQL confiável. O script rejeita o marcador padrão e uma segunda execução para o mesmo proprietário.
4. Configure o domínio, URLs de retorno e SMTP do Auth, conforme o guia de implantação.
5. Entre como administrador e convide os gerentes/vendedores. Configure o código externo do vendedor antes de importar vendas.
6. Importe dados reais pelo fluxo autenticado da aplicação.

Não execute o bootstrap de produção em uma base de homologação, ou vice-versa. Migrações posteriores devem ser adicionadas como novos arquivos versionados.

## Escopos

- Administrador: apenas sua organização, com acesso aos dois quiosques.
- Gerente: apenas seu quiosque e seus vendedores.
- Vendedor: próprio perfil, carteira, tarefas e vendas autorizadas.
- Perfil inativo: nenhuma leitura comercial ou operação RPC, mesmo com um JWT ainda não expirado. A desativação de vendedor libera suas tarefas pendentes para redistribuição e preserva as concluídas.
- Clientes sem carteira própria só ficam visíveis ao vendedor quando uma tarefa é atribuída a ele.

Os clientes recebem apenas SELECT por políticas RLS. Não podem alterar diretamente tabelas comerciais, perfis ou permissões. As mutações passam por funções que validam papel, organização, loja e parâmetros. Auditoria é somente leitura para administradores/gerentes do escopo correspondente.

O privilégio `service_role` deve permanecer no servidor. Ele não é necessário para os relatórios nem para as mutações operacionais do navegador.

## Funções da equipe e histórico

`change_staff_role(p_profile_id uuid, p_role text, p_store_id uuid DEFAULT NULL)` retorna o perfil atualizado e exige um administrador ativo da mesma empresa. `admin` exige quiosque nulo; `manager` e `seller` exigem um quiosque da empresa. A operação preserva a situação ativa/inativa do perfil. Um administrador pode rebaixar a própria função somente se houver outro administrador ativo. O último administrador ativo não pode ser rebaixado ou desativado; o erro retorna `DETAIL = LAST_ACTIVE_ADMIN`. A desativação da própria conta permanece bloqueada.

Alterações de função, acesso e provisionamento usam a mesma trava por organização, com releitura do ator após a espera. Distribuição e geração de contatos respeitam essa mesma ordem de travas. Ao deixar de ser vendedor ou trocar de quiosque, o funcionário libera as tarefas pendentes para redistribuição; contatos concluídos, autoria das vendas, metas e referências da última compra permanecem preservados.

`profile_store_memberships` mantém vínculos históricos para as chaves comerciais; `profile_external_ids` preserva os códigos do PDV por quiosque, inclusive códigos substituídos. Essas tabelas não concedem acesso ao navegador e não determinam a autorização: a função e o quiosque atuais de `profiles` continuam definindo a RLS. Um código histórico do PDV não pode ser transferido para outro funcionário. Isso evita atribuir vendas antigas à pessoa errada em uma reimportação.

Os relatórios podem agrupar e filtrar vendedores históricos da loja autorizada mesmo após promoção ou transferência. O helper de histórico retorna somente identificador, quiosque e nome comercial; gerentes não recebem o perfil completo nem o e-mail de um funcionário promovido a administrador. A geração de novos contatos exige vendedor ativo no quiosque atual, independentemente das referências históricas da carteira.

## Importação CSV normalizada

A função `import_presence_batch(p_store_id uuid, p_payload jsonb)` aceita este formato após a conversão do CSV e validação no servidor:

```json
{
  "customers": [
    {"external_id":"C001","name":"Cliente","phone":"5511999998888","birth_date":"1990-05-20","responsible_external_id":"V001"}
  ],
  "sales": [
    {"external_id":"VENDA001","customer_external_id":"C001","seller_external_id":"V001","sold_at":"2026-10-25T13:00:00-03:00","gross_amount":500,"discount_amount":50,"returned_amount":0,"status":"completed"}
  ]
}
```

O código `V001` precisa estar em `profiles.external_id` no mesmo quiosque. A importação:

- Rejeita referências desconhecidas, formatos inválidos, campos não previstos, valores negativos e descontos acima do bruto.
- Em atualizações de clientes, preserva telefone/aniversário quando a coluna estiver ausente; null ou vazio explícito limpa o campo.
- Rejeita datas de venda sem fuso horário e lotes acima de 5.000 registros.
- É transacional: falha em uma venda desfaz todo o lote, inclusive clientes recém-criados.
- Atualiza registros existentes usando o identificador externo dentro de cada quiosque. Campos opcionais ausentes na atualização de vendas preservam cliente, vendedor, descontos, devoluções e situação já conhecidos; valores explícitos substituem esses campos.
- Recalcula a carteira pela última compra válida no próprio quiosque.
- Preserva recusas de contato já registradas no Valance.
- Registra uma execução `manual_csv` concluída. Isso não representa uma sincronização automática com a API do Presence.

`status` aceita `completed` ou `cancelled`; devoluções são atualizadas no registro da venda em `returned_amount`. A base atual preserva o valor acumulado devolvido e a atualização, mas não representa um livro de eventos de devolução por data. Indicadores separados por data da devolução exigem o histórico correspondente da origem.

## Agendas e atendimento

`generate_agenda_tasks(p_store_id, p_agenda_id)` usa a data atual no fuso da organização:

- `birthday`: aniversários do dia.
- `post_sale`: última compra no dia anterior.
- `reactivation`: última compra há pelo menos 60 dias.
- `manual` / `custom`: clientes elegíveis da loja.

A geração exige telefone cadastrado, exclui clientes com recusa de contato e evita criar tarefas para a mesma agenda quando já houver uma pendente ou uma tarefa gerada nos últimos 15 dias. Mantém o responsável da última compra quando ele ainda é um vendedor ativo; caso contrário, deixa o contato disponível para distribuição.

Essas regras iniciais precisam ser aprovadas pelo cliente antes da operação. A geração é acionada pela interface; não há extração automática do Presence sem a documentação e autorização da API.

`assign_contacts` usa bloqueio de linhas e valida todos os vendedores. Uma distribuição sem quantidade suficiente é revertida inteira. `complete_contact` aceita `contacted`, `no_response`, `invalid_number` e `opt_out`. Apenas `contacted` qualifica para atribuição e conversão. `opt_out` bloqueia novos contatos e gerações para o cliente.

A confirmação de contato é manual. Abrir um link do WhatsApp não registra mensagem enviada nem confirma entrega/leitura.

## Relatórios

`report_snapshot(p_store_id, p_from, p_to, p_seller_id DEFAULT NULL, p_agenda_id DEFAULT NULL, p_minimum DEFAULT 0)` aplica RLS e agrega diretamente no PostgreSQL, sem depender do limite de linhas das consultas do frontend. Os filtros opcionais de vendedor (vendedor que fechou a venda), última agenda atribuída e valor mínimo da venda são aplicados também ao comparativo de 364 dias e às exportações que usam o snapshot. Tarefas respeitam vendedor atribuído e agenda. Vendedores não podem escolher outro vendedor nem um quiosque fora do próprio escopo. Retorna valores brutos antes do desconto, devoluções separadas, pedidos, contatos, metas cadastradas e agrupamentos por dia, vendedor, agenda e quiosque.

A venda recebe no máximo uma atribuição de agenda: o contato `contacted` mais recente antes da compra, no mesmo quiosque, dentro de 15 dias. O vendedor da compra permanece separado do responsável pelo contato. Não existem proporções fixas de atribuição.

Para vendedores, uma função agregada com escopo fixo no próprio utilizador permite contabilizar conversão e atribuição da sua conversa mesmo se outro vendedor fechar a compra. Ela não retorna identificadores ou linhas das vendas alheias; a receita de vendas do perfil continua restrita às suas próprias vendas.

A conversão acompanha clientes distintos com um contato válido no período e uma compra posterior em até 15 dias; coortes recentes são parciais. Vendas totalmente devolvidas não entram como conversão. A receita bruta e as atribuições brutas mantêm o valor original, com a devolução apresentada separadamente.

Metas mensais são cadastradas por `save_target`; não há metas comerciais inventadas. O comparativo anterior desloca o período em 364 dias.

Os agrupamentos `by_agenda`, `by_seller` e `by_store` incluem `previous_gross`, calculado sobre as vendas do período comparativo autorizado. Para gerentes e administradores, cada agenda também inclui `by_seller` e `by_store`, com identificador, nome, `gross` e `previous_gross`: são agrupamentos das mesmas vendas atribuídas à agenda por vendedor que fechou a compra e por quiosque. Não representam parcelas independentes nem canais de venda. Para vendedores, esses dois detalhamentos da agenda ficam vazios e o bruto da agenda, inclusive o comparativo, considera somente a assistência dos próprios contatos.

`totals.today_gross` e `totals.yesterday_gross` usam hoje e ontem no fuso da organização, independentemente do intervalo selecionado. Respeitam os filtros de quiosque, vendedor, agenda e valor mínimo e a autorização das vendas de fechamento. Esses valores não indicam sincronização contínua com o PDV: dependem dos dados efetivamente importados.

## Verificação local

`npm test` executa testes PostgreSQL em PGlite com funções `auth.uid()` e papéis simulados. Os testes exercitam RLS, isolamento entre organizações e lojas, RPCs, importação idempotente e transacional, distribuição, desativação, atribuição e recusa de contato. Eles não substituem o teste final com Auth, PostgREST e Realtime de um projeto Supabase real.
