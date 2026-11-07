# Publicação com Supabase e Netlify

Este guia prepara a implantação do Valance OS para dois quiosques e usuários com papéis de administrador, gerente e vendedor. A configuração real dos serviços, o envio de convites e a aplicação da migração precisam ser concluídos na conta proprietária do projeto.

## O que está implementado e o que depende de configuração

- Banco PostgreSQL com regras por organização, quiosque e usuário; RPCs para distribuição, contatos, metas e importação.
- Supabase Auth para sessões e recuperação/convite por e-mail.
- Netlify Functions para administração de usuários e importação autorizada.
- Frontend de produção que utiliza a sessão e os dados do banco; a demonstração continua separada.
- Importação manual padronizada de clientes e vendas, sem assumir endpoints do Presence.
- Endpoint reservado à integração do Presence, sem agendamento ativo. Enquanto o adaptador oficial não existir, ele retorna estado **bloqueado**, sem consultar ou modificar o banco.

Não estão configurados por este código: contas e cobrança dos serviços, domínio público, SMTP, backup/PITR do Supabase e acesso à API do Presence. Publicar o frontend não conclui essas etapas.

## 1. Criar o projeto Supabase

1. Utilize uma conta da empresa e crie um projeto em uma região adequada à operação.
2. Guarde a senha do banco no gerenciador de segredos da empresa.
3. Copie a URL do projeto e a chave pública (publishable ou anon).
4. Separe a chave de servidor (service role/secret) para as funções. Ela nunca deve aparecer no frontend, no Git ou em arquivos compartilhados.
5. Execute a migração `supabase/migrations/202610250001_initial.sql` pelo SQL Editor ou pela CLI do Supabase, revisando a execução antes de aplicar em uma base com dados existentes.
6. Execute o procedimento em `supabase/README.md` e o arquivo `supabase/bootstrap.sql` para a organização, os dois quiosques e o primeiro administrador. Não use dados fictícios de demonstração como dados reais.

O banco não cria vínculo ou função de administrador a partir de metadados enviados no cadastro público. Um usuário sem perfil ativo não consegue acessar os dados comerciais.

## 2. Configurar a autenticação

No painel de autenticação do Supabase:

- Ative o provedor de e-mail.
- Desative novos cadastros públicos. Funcionários recebem convites por usuários autorizados.
- Configure um provedor SMTP de produção, com remetente da empresa e autenticação do domínio.
- Configure a Site URL com o endereço final do site.
- Adicione somente os redirecionamentos necessários, por exemplo:
  - `https://SEU_SITE.netlify.app/?auth=invite`
  - `https://SEU_SITE.netlify.app/?auth=recovery`
- Faça o mesmo para o domínio próprio, se utilizado. Não use curingas amplos de produção.
- Configure comprimento mínimo de senha de **12 caracteres no Supabase** (a validação da interface não substitui a política do servidor) e avalie MFA para administradores.

Se um convite for enviado e a vinculação ao quiosque falhar, a API informa `PROFILE_PROVISIONING_PENDING`. A conta permanece sem perfil e sem acesso; o administrador deve corrigir o vínculo pelo procedimento administrativo. A função não apaga uma conta Auth existente como tentativa de rollback.

O convite permite ao funcionário definir sua própria senha. A recuperação é enviada por e-mail; a API não retorna senhas e o gerente não conhece a senha definitiva do vendedor.

## 3. Conectar o repositório ao Netlify

1. Crie um site Netlify a partir de `GFaria0101/Valance-OS`.
2. Selecione a branch `main` e mantenha as configurações de `netlify.toml`:
   - build: `npm run build`;
   - saída: `dist`;
   - funções: `netlify/functions`;
   - Node.js: `22`.
3. Antes de publicar, configure as variáveis abaixo. O build de produção falha quando os valores públicos obrigatórios não estão preenchidos.

| Nome | Escopo | Conteúdo |
| --- | --- | --- |
| `VITE_APP_MODE` | Build | `production` |
| `VITE_SUPABASE_URL` | Build | URL HTTPS do Supabase |
| `VITE_SUPABASE_ANON_KEY` | Build | Chave pública publishable/anon |
| `SUPABASE_URL` | Functions | Mesma URL do Supabase |
| `SUPABASE_ANON_KEY` | Functions | Chave pública usada com o JWT do usuário |
| `SUPABASE_SERVICE_ROLE_KEY` | Functions, segredo | Chave de servidor, nunca `VITE_` |
| `APP_URL` | Functions | URL pública HTTPS deste ambiente |

`APP_URL` controla os redirecionamentos de e-mail e a origem permitida para mutações do navegador. Configure um valor específico para homologação e outro para produção. Não reutilize a base real em previews de pull requests.

Os escopos separados da tabela dependem do plano do Netlify. Em contas que não permitem selecionar escopos, as variáveis ficam disponíveis aos processos de servidor de build e funções. Restrinja os valores ao contexto `production`, mantenha a chave administrativa sem prefixo `VITE_` e confirme que ela não aparece nos arquivos publicados. O frontend lê somente os campos públicos definidos em `src/app-config.js`. Não é necessário contratar um plano apenas para a apresentação.

A configuração inicial aceita o domínio padrão `*.supabase.co`. Para usar um domínio personalizado do Supabase, revise a validação em `src/app-config.js` e a diretiva `connect-src` no CSP de `netlify.toml` antes da publicação.

O login pode ser testado localmente com Vite para o cliente Supabase, mas os endpoints de administração exigem Netlify Functions, por exemplo com `netlify dev` ou um deploy de homologação. Nenhum segredo deve ser colado no chat.

## 4. Preparar a operação

1. Entre como o primeiro administrador e confira os dois quiosques.
2. Cadastre/convide os gerentes de cada quiosque.
3. Convide vendedores com o quiosque correto.
4. Preencha o identificador externo de cada vendedor exatamente como aparece no Presence.
5. Defina metas e confira as agendas.
6. Importe um lote pequeno de clientes e vendas usando o formato de `docs/importacao.md`.
7. Gere as tarefas de agenda e distribua contatos ainda livres.
8. Registre um atendimento e confira o Dedo Duro.
9. Compare os valores importados com o relatório de origem antes de ampliar o uso.

Os responsáveis dos clientes são atualizados a partir da última compra concluída no mesmo quiosque, quando o vendedor externo está mapeado. A atribuição de vendas à agenda usa o último contato concluído antes da compra, dentro de 15 dias, no mesmo quiosque; não soma novamente a receita do vendedor.

A confirmação de atendimento pelo WhatsApp é **manual**. Abrir um link não prova envio, entrega ou leitura de mensagens.

## 5. Checklist de homologação

- [ ] Migração aplicada e primeiro administrador criado.
- [ ] Cadastro público desativado e SMTP funcionando.
- [ ] Convite recebido; senha definida pelo funcionário.
- [ ] Recuperação recebida no endereço correto.
- [ ] Gerente do quiosque 1 não consulta nem altera o quiosque 2.
- [ ] Vendedor não acessa clientes ou contatos de outro vendedor.
- [ ] Vendedor não muda papel, quiosque, responsável ou permissão pela API.
- [ ] Desativar funcionário bloqueia suas consultas e operações.
- [ ] Importar o mesmo lote não duplica vendas/clientes.
- [ ] Um erro de referência cancela o lote inteiro.
- [ ] Vendas canceladas e devoluções conferem com o Presence.
- [ ] Exportações respeitam os filtros e o acesso do usuário.
- [ ] URLs do WhatsApp funcionam no navegador/dispositivo real.
- [ ] Nenhuma chave de servidor está no bundle de `dist`.
- [ ] Backup e restauração foram configurados e testados.

## 6. Backup e continuidade

A existência do banco ou do job Netlify não equivale a backup configurado.

No Supabase, escolha os recursos de backups gerenciados e/ou PITR adequados ao plano da empresa. Verifique a frequência, retenção, localização e cobertura dos dados. Documente responsável, tempo aceitável de recuperação e perda aceitável de informações.

Faça uma restauração de teste em ambiente separado e confira os registros comerciais e as contas. Uma cópia local do frontend não contém os dados do banco. Se houver arquivos no Storage no futuro, defina também o backup desses objetos.

## 7. Presence e sincronização diária

Sem documentação oficial e autorização, o sistema não faz requisições ao Presence nem inventa endpoints. Use a importação manual enquanto a integração não é implementada.

Para habilitar a sincronização automática depois, obtenha:

- URL e documentação oficial;
- método de autenticação;
- recursos de lojas, vendedores, clientes, vendas, alterações, cancelamentos e devoluções;
- paginação e limites;
- identificação de alterações desde a última sincronização;
- ambiente de testes e regras de uso.

O adaptador deverá fazer importação idempotente, registrar falhas, permitir reprocessamento e validar resultados antes das 10h de Brasília. O agendamento será habilitado junto com o adaptador validado. Enquanto isso, a atualização dos dados do PDV depende da importação manual.

## 8. Publicar e acompanhar

Execute `npm test` e `npm run build`, valide a homologação e publique no Netlify. Configure domínio próprio e HTTPS quando aprovados. Acompanhe erros das funções, registros das importações manuais e falhas de integração quando ativada e utilização do banco. Dados de clientes, senhas e tokens não devem ser registrados nos logs.

Mantenha homologação e produção separadas. Mudanças no banco devem usar novas migrações, preservando a capacidade de recuperação; retornar a um deploy antigo não reverte automaticamente o banco.
