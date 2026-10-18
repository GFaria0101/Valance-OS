# Valance OS

Protótipo navegável de gestão de relacionamento e vendas, em português, inspirado nas referências visuais fornecidas. Feito com JavaScript, Vite, Lucide e fontes locais.

## Executar

Requer Node.js 20.19+ ou 22.12+.

```sh
npm ci --cache /workspace/.npm-cache
npm run dev -- --port 5173
```

Abra a aplicação e escolha **Entrar na demonstração**. O formulário de login também aceita uma identificação fictícia e uma senha fictícia de pelo menos quatro caracteres. Não há validação de credenciais reais.

```sh
npm run build
npm run preview -- --port 4173
```

## Telas e interações

- Visão geral com indicadores, gráfico, ranking e atalhos.
- Agendas com registro de contatos e conclusão.
- Painel de vendas e painel da loja com seleção de período.
- Relatórios por agenda, real time e produtividade; exportação CSV.
- Vendedores com busca, filtro de acesso, edição, cupons e simulação de geração de acesso.
- Perfil, tema claro/escuro e navegação responsiva.

Dados fictícios e alterações são armazenados em `localStorage`, somente no navegador atual. Para testar a busca de acesso, use o CPF fictício `52998224725`. “Adicionar vendedor” simula a localização e ativação de um vendedor já cadastrado na equipe.

Não há backend, autenticação real, WhatsApp, redefinição real de senha ou atualização de vendas em tempo real. As credenciais geradas são apenas demonstrativas e nunca devem ser usadas em produção. O botão de compartilhamento copia um resumo; nenhuma mensagem é enviada.

Para reiniciar os dados de demonstração, remova no armazenamento local do navegador as entradas com prefixo `valance-` e `contact-`.

## Validação realizada

Build de produção e fluxos automatizados com Playwright/Chromium: entrada, recuperação informativa, navegação de todas as telas, filtros de período e agenda, registro/conclusão de contatos, busca/edição/ativação de vendedores, persistência após recarregar, CPF inexistente e geração de acesso, exportação CSV, temas e layout móvel de 390 px sem transbordamento horizontal.
