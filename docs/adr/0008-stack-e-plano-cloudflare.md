# ADR 0008 — Stack do Venn Desk e plano Workers Paid

**Decidido** em 15/11/2026. **Estado:** aceito.

## Decisão
Worker com Hono, Zod e Prisma sobre Neon. Console interno em Vite + React SPA
servido como assets estáticos pelo próprio Worker. Widget source-only no
monorepo. Página de status em Astro estático, hospedada fora da Cloudflare.
Plano **Workers Paid**, contratado em 15/11/2026.

## Por quê
- **Prisma, não Drizzle:** é o ORM do `venn-saas`. Um ORM só na casa, e o lint
  de migração do portão de CI já existe.
- **Vite, não Next:** o Console é interno, atrás de login, sem SEO nem SSR — e
  o Vite builda e roda no macOS 12.6 desde que o plugin da Cloudflare fique
  fora. Os apps perderam o loop local; o Console não precisa perder.
- **Workers Paid:** e-mail a destinatário arbitrário no Email Sending exige
  plano pago, e o Workers Builds sobe para 6.000 minutos e 6 builds
  simultâneos. Com os três apps e o Desk publicando do mesmo lugar, um build
  por vez seria o gargalo da Fase 5.

## Consequências
Duas toolchains de front na casa (vinext nos apps, Vite no Console). Aceito: o
vocabulário visual continua um só, porque shadcn/ui e Tailwind v4 são os
mesmos.
