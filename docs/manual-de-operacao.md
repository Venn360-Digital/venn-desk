# Manual de operação

O que fazer quando algo dá errado. Cada seção começa pelo sintoma, porque é o
que você tem às duas da manhã.

Antes de tudo: **o Console é a verdade**. Slack, e-mail e página de status são
superfícies. Se as três discordarem do Console, o Console está certo.

## A IA respondeu errado a um cliente

1. **Pare o sangramento no app, não no mundo.** Console → Apps → desligue
   "atendimento automático" daquele app. Os outros dois seguem atendendo, e o
   chamado volta para a fila humana.
2. Leia a trilha do chamado. Todo passo da IA está em `ticket_events`: a
   ferramenta chamada, os parâmetros e o resultado.
3. Se a resposta saiu de um artigo errado, corrija o artigo. Se o artigo é
   DERIVADO, corrija a fonte no `venn-saas` — o Desk re-deriva em até uma hora.
   Editar um derivado à mão é recusado com 409, de propósito.
4. Se a resposta não saiu de artigo nenhum, o problema é a instrução. Console →
   Apps → "instruções do agente", e rode `pnpm bateria <app> --confirmar` antes
   de religar.

**O que NÃO fazer:** apagar a mensagem. Exclusão é lógica aqui, e a trilha com o
erro é o que permite não repeti-lo.

## O Slack caiu, ou o Bridge parou de responder

Nada para fazer com urgência. **Os chamados continuam sendo registrados e
atendidos pelo Console** — o Slack é superfície de trabalho, não a fonte.

O que você perde enquanto ele está fora: a thread por chamado, os botões, as
reações e os alertas. O que continua: abertura pelo widget, atendimento pela IA,
resposta pelo Console, e-mail ao cliente, SLA e a página de status.

Para confirmar que é o Slack e não nós: `npx wrangler tail --env producao` e
procure `[slack]`. Os motivos têm nome — `sem_token`, `sem_canal`,
`autor_nao_cadastrado`, `thread_sem_chamado`.

Quando voltar, os chamados abertos durante a queda **não ganham thread
retroativa**. O espelho acontece na abertura; refazê-lo depois criaria threads
fora de ordem numa semana de conversa.

## O GitHub caiu

A base viva para de sincronizar e o diagnóstico do N2 para de rodar. O
atendimento não é afetado: a base já está no banco e o agente lê de lá.

A sincronização tenta a cada cinco minutos e registra a falha em
`kb_sincronizacoes.erro`, visível no Console → Base. Não há o que fazer além de
esperar: quando o GitHub voltar, a próxima rodada pega o commit mais recente e a
base fica em dia de uma vez.

## A conta da IA disparou

1. Console → Painel → "Gasto de IA por origem". Ele diz **com o quê**: 
   atendimento, documentação de tela, sincronização, rascunho de artigo ou
   diagnóstico.
2. Se for atendimento, o teto por chamado é 150 mil tokens e o evento
   `agente:teto` marca quem bateu nele. Muitos estouros significam chamados
   longos demais, não preço alto.
3. Se for bateria, ela é manual: ninguém a roda sem `--confirmar`, e cada rodada
   é uma linha em `docs/medicoes/bateria.jsonl`.
4. Para parar de verdade: desligue o atendimento automático dos apps. O cão de
   guarda avisa em 60% e no estouro do teto diário, mas **não corta nada** —
   cortar deixaria cliente sem resposta por causa de uma conta.

## O saldo da API da Anthropic acabou

Sintoma: `credit balance is too low` no log, chamados sem resposta automática,
sincronização falhando.

Nada quebra em cascata. O atendimento volta a ser humano, a base para de
atualizar e tudo o mais segue. Recarregue em Plans & Billing; o cron pega a
próxima rodada sozinho.

## Um cliente pediu exclusão dos dados (LGPD)

Rota de ADMIN:

```bash
curl -X POST "https://desk.venn360.com/api/console/app/<slug>/titular/<requesterId>/esquecer" \
  -H 'content-type: application/json' -d '{"confirmo": true}'
```

Isto é **irreversível**. Substitui nome, e-mail, o texto que o titular escreveu e
o contexto do widget; marca os anexos para expurgo. A resposta do atendente, os
eventos e os prazos ficam — são a prova de que o atendimento aconteceu, que é o
que uma auditoria pede para ver.

## A página de status mostra "desconhecido"

Significa "não verificamos há tempo demais", e é problema nosso, não do app.
Confira se a URL de saúde está cadastrada (Console → Apps) e se o cron está
rodando (`wrangler tail` e procure `[saude]`).

## Um app novo entrou no ar e nada funciona

Rode o roteiro na ordem: `node scripts/incluir-app.mjs` imprime os seis passos, e
cada um é de um painel diferente. O erro mais comum é o widget assinando com uma
chave cujo par público não foi cadastrado — o sintoma é 401 em toda abertura.

## Quem avisa quem

| Evento | Vai para |
| --- | --- |
| App fora do ar, prazo estourado, prazo em risco | `#desk-alertas`, na hora |
| Resumo do dia | `#desk-alertas`, 8h de São Paulo |
| Gasto de IA em 60% e no estouro do teto | `#desk-alertas`, na hora |
| Pedido de aprovação de issue | `#desk-aprovacoes` |
| Chamado novo, resposta do cliente | thread do chamado em `#desk-<app>` |
| Indisponibilidade | e-mail aos responsáveis e página de status |
