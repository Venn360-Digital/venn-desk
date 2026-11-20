# ADR 0012 — O N1 lê o mapa derivado, não o código ao vivo, e nunca o banco de app

**Data:** 19/11/2026 · **Estado:** aceita

## Contexto

O documento de referência que o André trouxe propõe um agente N1 com acesso de
leitura ao repositório e ao banco, investigando em tempo real. A especificação
do Venn Desk diz "N1 sem repositório" e, como regra absoluta, "nenhuma leitura
do banco de app nenhum".

## Decisão

1. **O N1 não lê código na hora de responder.** Ele lê o mapa derivado
   (ADR 0011), que carrega ponteiros `arquivo:linha` com a tag `tecnico` e o
   aviso "uso interno". Ao escalar para engenharia, o N1 já aponta ao N2 onde
   olhar. Código ao vivo é do N2, na Fase 5, pela mesma leitura do GitHub.
   Motivos: custo por pergunta (ler `nav.ts`, `plan-limits.ts` e uma FAQ a cada
   chamado multiplicaria o atendimento por dezenas de milhares de tokens),
   vazamento de detalhe interno em resposta a cliente, e código não ser
   resposta (`allowedRoles: MANAGER_ROLES` não se diz a ninguém).
2. **O N1 não lê banco de app.** O estado da conta do cliente ("por que a minha
   está assim") vem por uma **API de suporte somente leitura no venn-saas**,
   `GET /api/suporte/conta`, assinada pelo Desk (JWT Ed25519, `aud` = slug do
   app, `sub` = tenant externo, `exp` ≤ 60 s), devolvendo só o tenant do
   chamado: plano, ciclo, status da assinatura, créditos, números conectados,
   agentes pausados, unidades, papel do solicitante, versão. Nada de mensagens,
   contatos ou dados de pacientes. No Desk, a ferramenta `consultar_conta` só
   entra no catálogo quando a API existe; até lá, o N1 escala para humano.
3. **Modo sombra é a fase interna.** A pergunta do documento ("atende o cliente
   final ou é interno?") já tem resposta no desenho: o N1 redige e um humano
   revisa até os indicadores autorizarem o automático.

## Consequências

- O custo por chamado fica na ordem de US$ 0,10–0,25 (artigo por tela, cache
  de prompt), e não em dólares.
- A bateria de avaliação inclui fatos proibidos (nome de arquivo, tabela,
  variável) e reprova a resposta que os repete ao cliente.
- A API de suporte e o tenant de laboratório para a navegação são trabalho do
  venn-saas, pela outra sessão, e destravam as etapas 6 e 7 do plano.
