# ADR 0009 — Um parâmetro na raiz reserva o espaço inteiro

**Data:** 17/11/2026
**Estado:** aceito

## Contexto

O mesmo defeito apareceu duas vezes, em duas fases diferentes.

Na Fase 1, `/api/:app/*` engolia `/api/console/sessao`: o middleware casava com
`:app = "console"`, procurava um app com esse slug, não achava e respondia 404.
A rota do Console existia e era inalcançável. Foi consertado renomeando aquele
caminho para `/api/app/<slug>/…`.

Na Fase 3, o mesmo defeito reapareceu no vizinho. `/api/console/:app/*` engolia
`/api/console/apps/odontobox` (`:app = "apps"`) e `/api/console/saude/verificar`
(`:app = "saude"`). O `PATCH /api/console/apps/:slug` estava escrito, tipado e
publicado desde a Fase 2 — e nunca havia funcionado, porque nenhum teste e
nenhum aceite o chamava. Quem o descobriu foi o aceite da verificação de saúde,
que precisava dele para gravar o endereço sondado.

Os dois casos não compilam diferente, não emitem aviso e não falham no portão. O
sintoma é um 404 de "app não encontrado", que parece erro de cadastro.

## Decisão

**Um prefixo com parâmetro na raiz de um espaço reserva o espaço inteiro.** Em
nenhuma posição um `:parametro` pode disputar lugar com um segmento literal sob
o mesmo prefixo.

Na prática, todo espaço por app leva um segmento literal antes do parâmetro:

- `/api/app/<slug>/…` — o que o widget consome
- `/api/console/app/<slug>/…` — o que o Console consome por app
- `/api/console/<coisa>` — o que o Console consome fora de app (`sessao`,
  `apps`, `saude`)
- `/api/status/<slug>` — a rota pública, onde `:app` é o último segmento e não
  prefixa nada

E a regra é verificada, não combinada: `scripts/lint-rotas.mjs` lê os registros
de rota de `src/rotas/`, compara todos os pares e reprova o portão quando um
parâmetro cobre um literal. Está no CODEOWNERS, junto com a auditoria de
isolamento.

## Consequências

- O caminho do Console mudou de `/api/console/<slug>/…` para
  `/api/console/app/<slug>/…`. A SPA e `scripts/aceite-fase-1.mjs` foram
  ajustados. Não há cliente externo nesse espaço: é interno, atrás de login.
- O guarda é estrutural e roda em ~10 ms. Ele teria pego os dois casos.
- A lição mais geral, que vale além de rota: **consertar a ocorrência não impede
  a reincidência.** As duas primeiras vezes foram tratadas como "renomeie este
  caminho"; a terceira teria vindo no próximo espaço com parâmetro. O que fecha
  a classe é a medição.
- O `*` continua curinga de propósito — é como middleware se registra — e por
  isso não entra na regra.
