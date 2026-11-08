# Apresentação do Valance OS

Endereço do ambiente: https://gregarious-mooncake-61afc7.netlify.app

## Primeiro acesso

O administrador recebe um convite do Supabase no e-mail informado para a implantação. Abra o link, defina uma senha de pelo menos 12 caracteres e entre no site com esse e-mail. Confira a pasta de spam se a mensagem não aparecer. O convite é pessoal; não compartilhe o link de definição de senha.

O ambiente contém dois quiosques identificados como apresentação, funcionários fictícios, 56 clientes de exemplo, 112 vendas de exemplo e tarefas para demonstrar o atendimento. As vendas incluem um período anterior de 364 dias. Nenhuma venda foi obtida do Presence.

As contas de exemplo usam endereços terminados em `@valance.invalid`, sem caixa de e-mail e sem convites enviados. Elas servem para compor a equipe e testar permissões. Convites e recuperação para funcionários reais exigem envio de e-mail configurado e validado; o remetente padrão do Supabase possui restrições.

## Roteiro sugerido

1. Abra o menu pelo botão com o nome do utilizador e os três traços.
2. Navegue pela visão geral, pelo painel de vendas e pelo painel da loja.
3. Use datas personalizadas e confira Gerou por agenda, Gerou por loja e Dedo Duro.
4. Abra os indicadores, o Ranking do Real Time e as exportações CSV e Excel. O Excel separa as tabelas em abas.
5. Distribua os contatos ainda livres para vendedores do quiosque selecionado.
6. Nas agendas, registre um atendimento e confirme a atualização dos indicadores.
7. Abra o WhatsApp pelo cabeçalho e informe um número de teste autorizado. Os clientes fictícios não possuem telefones reais.
8. Edite um funcionário fictício, confira as permissões e compartilhe a lista quando necessário.
9. Como administrador, use **Alterar função** para promover ou rebaixar alguém. Administrador acessa os dois quiosques; gerente e vendedor exigem a escolha de um quiosque. Vendas e atendimentos anteriores permanecem no histórico.
10. Para editar outro administrador ou solicitar a recuperação dele, use os botões da própria linha. A recuperação envia o link ao e-mail do titular. A empresa precisa manter pelo menos um administrador ativo.

O WhatsApp abre a conversa no aplicativo ou navegador; o envio e a confirmação do atendimento são manuais.

## Conexão e saída automática

Na tabela de vendedores, a bolinha verde indica uma conexão recente com o Valance OS; a cinza indica ausência de conexão recente. Passe o cursor sobre a bolinha para conferir a indicação. O status é atualizado automaticamente e pode levar até dois minutos para refletir o fechamento do navegador. A coluna Acesso continua indicando se a conta está ativa ou desativada.

A sessão é encerrada após uma hora sem interação com o site. Cliques, digitação, rolagem, toque e movimento do mouse contam como atividade. Atualizações automáticas, relógio, renovação do token e recarregamento da página não reiniciam esse prazo. A atividade em outra aba do Valance OS no mesmo navegador mantém a sessão; outro navegador ou dispositivo tem seu próprio prazo.

Depois da expiração é necessário entrar novamente. O servidor também bloqueia os dados da sessão expirada, mesmo que seu token de autenticação ainda esteja válido.

## Dados e limitações desta etapa

- Clientes e vendas entram por CSV, usando os modelos da tela Importar dados. A importação deve ser para o quiosque correto.
- As alterações gravadas no Supabase são distribuídas aos usuários conectados. Isso não consulta automaticamente o PDV.
- A integração e o agendamento de atualização do Presence permanecem desativados.
- Canais e projeções que não existem no arquivo importado aparecem como “—”. As parcelas de origem de receita não são estimadas a partir de percentuais fictícios.
- O SSS exibido compara os valores disponíveis com o período deslocado em 364 dias. Sem base de comparação positiva, a porcentagem fica indisponível.
- A próxima janela de atendimento às 10h de Brasília depende de geração e distribuição das tarefas pelo gerente; ela não significa uma importação automática.
- O ambiente de apresentação não deve receber dados reais de clientes. Antes da operação, configure uma base apropriada, SMTP, backups e restauração e confira os relatórios com a origem.

Os procedimentos de implantação e importação estão em [deploy.md](deploy.md) e [importacao.md](importacao.md).
