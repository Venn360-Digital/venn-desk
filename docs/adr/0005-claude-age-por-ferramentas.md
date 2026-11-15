# ADR 0005 — O Claude age por ferramentas, não por texto solto

**Decidido** em 13/11/2026. **Estado:** aceito.

## Decisão
O Venn Desk expõe um servidor MCP com as ações de atendimento, com credencial
por app. O que o Claude escreve na thread é interno; ao cliente só chega o que
passa por `responder_usuario`.

## Consequências
Separa conversa interna de resposta ao cliente, limita a IA às ações
permitidas, e serve com o mesmo contrato o agente via API, o Claude Code no
Slack e qualquer executor futuro que aceite MCP. Não existe ferramenta de
aprovação nem de deploy em produção — essas são botão para humano cadastrado.
