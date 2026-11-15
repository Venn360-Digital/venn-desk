# ADR 0002 — Widget como pacote, sem lógica de negócio

**Decidido** em 13/11/2026, revisado em 15/11/2026. **Estado:** aceito.

## Decisão
O widget é um pacote React source-only, `packages/desk-widget` no monorepo
`venn360/venn-saas`, e fala apenas com a API HTTP do Venn Desk.

## Consequências
Quem builda é o app hospedeiro, então o pacote não publica em registry e exige
`@source` explícito no `globals.css` de cada app para o Tailwind ver suas
classes. Instalar é três passos por app e nenhuma tabela nova neles.

## Revisão de 15/11/2026
A versão original previa pacote npm publicado, porque os apps viviam em três
repositórios. Com o monorepo, publicar deixou de fazer sentido: pacote interno
é source-only. A API do componente não mudou.
