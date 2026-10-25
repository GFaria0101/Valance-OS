# Importação de clientes e vendas

A primeira integração disponível é a importação manual padronizada. Ela permite trazer exportações do Presence sem assumir que seu arquivo ou sua API têm um formato já conhecido. Antes de importar, ajuste as colunas para o modelo abaixo e valide com o responsável pelo PDV.

## Regras

- Administrador: importa nos quiosques da própria organização.
- Gerente: importa apenas no próprio quiosque.
- Vendedor: não importa dados.
- Cada lote contém até 500 clientes e até 500 vendas e deve ter até 1 MiB em JSON.
- `external_id` identifica um registro no Presence, dentro do quiosque. Reimportar o mesmo identificador atualiza o registro em vez de criar duplicação.
- Uma referência externa desconhecida cancela o lote; não é criada uma pessoa/vendedor fictício para fazer os números passarem.
- Valores monetários usam números decimais em reais, sem símbolo `R$`.
- Datas de venda incluem o fuso horário. Nas datas de nascimento, use `AAAA-MM-DD`.
- Clientes e vendedores das vendas podem ser nulos quando a origem realmente não identifica essas pessoas. Identificadores preenchidos precisam existir no mesmo quiosque.

## Clientes

| Coluna | Obrigatória | Exemplo |
| --- | --- | --- |
| `external_id` | Sim | `C1001` |
| `name` | Sim | `Cliente de exemplo` |
| `phone` | Não | `+5521999998888` |
| `birth_date` | Não | `1990-08-21` |
| `responsible_external_id` | Não | `V001` |

Em clientes existentes, omitir `phone` ou `birth_date` preserva o valor armazenado. Enviar explicitamente `null` ou uma célula vazia limpa o campo.

`responsible_external_id` corresponde ao código externo do vendedor já cadastrado no Valance. Ao importar vendas, a última compra concluída pode atualizar esse responsável no quiosque.

## Vendas

| Coluna | Obrigatória | Exemplo |
| --- | --- | --- |
| `external_id` | Sim | `VENDA-1001` |
| `customer_external_id` | Não | `C1001` |
| `seller_external_id` | Não | `V001` |
| `sold_at` | Sim | `2026-10-25T14:30:00-03:00` |
| `gross_amount` | Sim | `350.00` |
| `discount_amount` | Não, padrão 0 | `20.00` |
| `returned_amount` | Não, padrão 0 | `0.00` |
| `status` | Não, padrão `completed` | `completed` ou `cancelled` |

Em vendas existentes, omitir `customer_external_id`, `seller_external_id`, `discount_amount`, `returned_amount` ou `status` preserva o valor armazenado. Enviar referência explicitamente vazia ou `null` desvincula cliente/vendedor; para zerar desconto/devolução envie o número `0`. Valores monetários e situação não aceitam `null`. Em novas vendas, campos opcionais omitidos usam os padrões documentados. Se um novo valor bruto entrar em conflito com descontos/devoluções preservados, o banco rejeita o lote inteiro.

A receita bruta não desconta o desconto comercial. Devoluções são armazenadas separadamente. O formato atual recebe o valor devolvido acumulado na própria venda; ele não fornece eventos de devolução com data independente. Para relatórios por data real da devolução será necessário receber esses eventos do Presence e ampliar o contrato de importação.

Trocas devem ser conciliadas com os documentos de venda/devolução que o Presence exportar. Não envie duas linhas com o mesmo identificador no mesmo lote. Não transforme uma troca em nova receita sem conferir a origem.

## Endpoint autenticado

```text
POST /.netlify/functions/api?action=import-presence
Authorization: Bearer <sessão do usuário>
Content-Type: application/json
```

```json
{
  "store_id": "UUID_DO_QUIOSQUE",
  "payload": {
    "customers": [
      {"external_id":"C1001","name":"Cliente de exemplo","phone":"+5521999998888","birth_date":"1990-08-21"}
    ],
    "sales": [
      {"external_id":"VENDA-1001","customer_external_id":"C1001","seller_external_id":"V001","sold_at":"2026-10-25T14:30:00-03:00","gross_amount":350,"discount_amount":20,"returned_amount":0,"status":"completed"}
    ]
  }
}
```

A importação é transacional. O resultado retorna as quantidades processadas e o identificador do registro de sincronização. Erros de validação não expõem dados internos do banco.

O CSV importado pelo frontend é convertido para esse contrato. O exportador atual do Presence ainda precisa ser conferido: separador, codificação, cabeçalhos, identificadores e tratamento de cancelamentos/devoluções. Uma importação manual não é atualização automática ou em tempo real do Presence.

Depois de importar: confira os totais com a origem, gere as tarefas de agenda e valide alguns clientes, responsáveis e vendas antes de ampliar o lote.
