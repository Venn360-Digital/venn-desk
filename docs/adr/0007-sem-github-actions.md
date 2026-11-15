# ADR 0007 — Sem GitHub Actions

**Decidido** em 13/11/2026. **Estado:** aceito.

## Contexto
Os apps removeram `.github/workflows/` em 13/11/2026: com o billing travado,
nada ali era obrigatório para mesclar e PRs saíam sem verificação. A
verificação virou `scripts/ci-worker.mjs`, rodada no build de preview do
Worker, e o check do PR é o próprio preview.

## Decisão
O Venn Desk e os apps não usam GitHub Actions. Build, portão de CI e deploy
ficam no Workers Builds. O GitHub guarda código, issues, PRs e proteção de
branch.

## Consequências
Nenhuma fase cria workflow. Tarefa agendada vira Cron Trigger, tarefa longa
vira fila, teste de fumaça roda no próprio Worker. O executor alternativo com
`claude-code-action` foi descartado junto.
