# ADR 0011 — A base de conhecimento é derivada do repositório, não escrita à mão

**Data:** 19/11/2026 · **Estado:** aceita

## Contexto

O N1 responde pelo que está em `kb_articles` com status PUBLICADO. Em 19/11/2026
não havia um artigo publicado em nenhum dos três apps. Os apps recebem feature
nova todo dia (cerca de quinze commits por dia em `main`), então um artigo
escrito à mão nasce desatualizado em dias e ninguém manterá centenas de textos.

O produto já carrega as próprias fontes de verdade em arquivos que mudam junto
com o código: o menu com rótulos (`nav.ts`), a FAQ in-app de cada produto,
planos e limites (`plan-limits.ts`, `plans.ts`), as regras em `PRODUCT.md`, o
vocabulário por marca, os e-mails transacionais, os papéis, e os commits
escritos em linguagem de usuário. O mercado faz o mesmo: kapa.ai e Inkeep
indexam o repositório e citam arquivo e linha; Mintlify reescreve a
documentação a cada merge; Intercom Fin detecta lacunas nas conversas e propõe
rascunhos.

## Decisão

1. **Artigo derivado.** `kb_articles` ganha `origem` (MANUAL | DERIVADO |
   SUGERIDO), `chave` estável, `fonte`, `dados`, `sincronizadoEm` e
   `statusFixadoPor`. O derivado é regenerado a cada mudança de `main`, por
   upsert pela chave, e **publica direto** (decisão do André: texto já em
   produção no produto não precisa de segundo revisor). Fonte que sumiu →
   artigo ARQUIVADO, com evento.
2. **Derivado não se edita à mão** (409 com o caminho da fonte) **nem se
   arquiva à mão**: só sai do ar. Uma pessoa mexendo no status de um derivado
   fixa a decisão; a sincronização a respeita.
3. **Allowlist de caminhos.** O Desk lê só o que o catálogo (`fontes.ts`) e a
   tabela de módulos (`mapa/modulos.ts`) nomeiam. `docs/` do venn-saas
   (engenharia reversa de concorrente) e `plataforma/` (console interno) nunca
   entram. Um teste prova.
4. **Extração estruturada, ancorada.** Fontes determinísticas por parser;
   as que são código irregular passam pelo modelo com esquema Zod `strict()` e
   ancoragem: toda string e todo número da saída precisa existir no arquivo. O
   que o modelo "lembrou" ou um comentário "pediu" é recusado — e a fonte falha
   alto, com o artigo anterior no ar e a data antiga visível.
5. **Vocabulário por app.** O core é compartilhado; o extrator deixa
   placeholders (`{{Pessoas}}`) e a renderização os resolve por marca. Todo
   derivado é por app; nunca global.
6. **Mapa técnico em duas passadas.** A primeira é determinística (índice
   Módulo → Tela → Componente → API → Tabela, por sha de blob, reaproveitado
   entre rodadas). A segunda, com o modelo, escreve a documentação funcional
   por tela e por módulo.
7. **Fila própria** (`CONHECIMENTO`), cron a cada cinco minutos com ETag no
   ramo, no máximo uma sincronização automática por hora por app.
8. **Busca híbrida.** `embedding` passa a `vector(1024)` (bge-m3 do Workers
   AI, sem chave nova); palavra e cosseno fundidos por posição; sem o binding,
   a busca é a de antes.
9. **Custo com três botões desde o início:** Message Batches para o que não é
   atendimento, cache de prompt, e Haiku 4.5 na passada incremental.

## Consequências

- O N1 passa a ter, sem ninguém escrever, o menu, a FAQ, os planos e o mapa
  técnico dos três apps — e a documentação funcional por módulo a partir da
  etapa seguinte.
- Corrigir um artigo derivado é corrigir o produto. A FAQ triplicada e
  divergente no venn-saas aparece no Console como divergência, não some.
- O Worker precisa de um token de leitura do GitHub (`GITHUB_TOKEN_LEITURA`,
  `Contents: read`), da fila `CONHECIMENTO` nos dois ambientes e do Workers AI.
- Artigo manual continua existindo para o que não está em arquivo nenhum.

## Ver também

- ADR 0012 — o N1 não lê código ao vivo nem banco de app.
- `docs/PROJETO-VENN-DESK.md`, Fase 4.
- Plano de 19/11/2026 em `~/.claude/plans/clever-twirling-catmull.md`.
