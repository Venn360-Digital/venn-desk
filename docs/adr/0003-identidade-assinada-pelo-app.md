# ADR 0003 — Identidade assinada pelo app

**Decidido** em 13/11/2026. **Estado:** aceito.

## Decisão
O backend de cada app expõe uma rota protegida pela sessão do Better Auth que
assina um JWT curto (EdDSA, 10 minutos) com app, tenant, usuário, papel e
plano. O Venn Desk só aceita chamado com esse token.

## Consequências
Garante "apenas usuários logados" sem o Desk nunca ler o banco de app nenhum, e
sem o app nunca enviar cookie de sessão ao Desk. A chave privada é segredo do
Worker de cada app, uma por app e por ambiente; a pública fica no cadastro do
app. O Desk cria tenant e solicitante a partir das claims.

Com o monorepo, a rota nasce uma vez em `packages/core` e serve os três apps.
