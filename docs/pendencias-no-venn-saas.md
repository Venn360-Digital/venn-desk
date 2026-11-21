# Pendências no venn-saas

O que o Venn Desk encontrou no `Venn360-Digital/venn-saas` e **não pode
corrigir**: este repositório é outro serviço, e a fronteira é de propósito
(ver `CLAUDE.md`). A lista existe para o André repassar a quem cuida do
monorepo.

Tudo abaixo foi verificado em `main` em 21/11/2026, com `git show`. Os itens 1
a 6 saíram do detector de divergências (`scripts/divergencias.mjs`), que
compara os artigos derivados dos três apps depois de dobrar o vocabulário de
cada marca; o que sobra foi escrito à mão em algum deles.

## 1. `PRODUCT.md` diz "OdontoBox360" para os três produtos

`PRODUCT.md`, linha 1 (título) e linha 206:

> `OdontoBox360 é **operador**. Isso precisa constar em contrato.`

O arquivo é a fonte das regras de produto dos **três** apps. O cliente do
Stagent360 lê hoje, num artigo sobre proteção de dados, que "o OdontoBox360 é
operador". É o item mais visível da lista: nome de outra marca dentro do
produto que a pessoa assinou.

**Sugestão:** trocar por um marcador que cada app substitua (o Desk já faz isso
com `{{organizacao}}`, `{{pessoa}}`, `{{profissional}}` e `{{servico}}`), ou
escrever "a plataforma".

## 2. `PRODUCT.md` usa "workspace" em texto que chega ao cliente

Linhas 15, 82, 182, 215, 224, 227 e 278. Exemplo (linha 82):

> `No dia 7, às 23:59, o workspace entra em **somente-leitura**.`

"Workspace" é o nome da tabela, não o nome que o cliente vê na tela (ele vê
unidade, clínica, agência ou empresa, conforme a marca). O Desk publica essas
regras como artigo, então a palavra chega ao atendimento.

A mesma linha 483 traz vocabulário fixo: "as unidades (workspaces) são as
**clínicas** dele" — "clínicas" no texto que o Conecta360 e o Stagent360 também
usam.

## 3. A FAQ do Odontobox360 tem "servico" sem cedilha

`apps/odontobox360/src/app/(dashboard)/suporte/page.tsx`:

> `servico e produto?', r: 'Serviço e servico ocupam cadeira e por isso têm duração'`

Como está sem cedilha, a substituição de vocabulário não reconhece a palavra, e
o artigo publicado diz "Serviço e servico ocupam cadeira" — onde devia dizer
"Procedimento e serviço". Aparece na pergunta e na resposta.

## 4. A FAQ do Stagent360 usa "empresa", que é o vocabulário do Conecta360

`apps/stagent360/src/app/(dashboard)/suporte/page.tsx`, quatro ocorrências:

> `empresa atende num feriado?'`, `Os feriados nacionais já vêm bloqueando a
> empresa`, `define quando a empresa atende`, `para a empresa se organizar`

O vocabulário do Stagent360 é "agência". O efeito prático: a pergunta "como
marco que a **empresa** atende num feriado" existe no Stagent e a equivalente
com "clínica" existe no Odontobox, então as duas bases ficaram com perguntas
que não se correspondem.

## 5. A FAQ é triplicada e divergente

29 itens em cada app, em três arquivos separados, com redações que já não batem
entre si (os itens 3 e 4 são sintomas disso). Qualquer correção precisa ser
feita três vezes, e hoje não é.

**Sugestão:** uma FAQ só em `packages/core`, com o vocabulário aplicado em
tempo de renderização, como o resto do core já faz.

## 6. Os e-mails automáticos divergem entre apps

O artigo derivado dos templates tem 2.176 caracteres no Odontobox360 e 3.044 no
Stagent360. Não é só vocabulário: há conteúdo a mais num deles. Vale conferir se
a diferença é intencional.

## 7. `PLAN_NAMES` chama o plano de "Multiclínica" nos três

`packages/core/src/lib/plan-limits.ts`, linha 123:

```ts
export const PLAN_NAMES: Record<PlanId, string> = {
    flow: 'Plano Digital',
    pro: 'Plano Prime',
    advanced: 'Plano Multiclínica',
}
```

O cliente do Conecta360 e do Stagent360 vê "Plano Multiclínica" na tabela de
planos que o atendimento publica.

## 8. O widget não preenche `versaoDoApp`

O Desk recebe `contexto.rota` e usa, mas `versaoDoApp` chega sempre vazio. Com
ele, um chamado diria em que versão o problema aconteceu. `CF_VERSION_METADATA_ID`
resolve.

## 9. Destravaria duas etapas paradas no Desk

- **API de suporte somente leitura** (`GET /api/suporte/conta`, JWT assinado
  pelo Desk, escopo do tenant do chamado). Sem ela, o N1 escala toda pergunta
  sobre estado da conta ("quantos créditos ainda tenho?"). Contrato na ADR 0012
  deste repositório.
- **Tenant de laboratório por app em homologação**, com dados semeados e sem
  número de WhatsApp, remetente nem cartão. É o que falta para a navegação
  automática nas telas (etapa 7) rodar sem disparar mensagem real.

## 10. A tela de catálogo mistura rótulo fixo e rótulo de vocabulário

`packages/core/src/rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx`,
linhas 55 a 62:

```ts
function CATEGORY_TONES(v: Vocabulario) {
    return {
        service: { label: 'Serviço', tone: 'primary' },
        procedure: { label: `${v.Servico}`, tone: 'info' },
        product: { label: 'Produto', tone: 'neutral' },
    }
}
```

No Odontobox360 o filtro de categorias mostra "Serviço" e "Procedimento" lado a
lado, porque a primeira é fixa e a segunda usa o vocabulário. No Conecta360 e no
Stagent360 as duas viram "Serviço", duas opções com o mesmo nome. A descrição do
diálogo na linha 449 também é fixa: "Produto ou serviço do catálogo".

Isto não impede o Desk de documentar a tela (ele copia o que está lá, e é o que
deve fazer), mas o artigo herda a ambiguidade da interface.

## Era meu, e está corrigido

Na primeira versão desta lista eu atribuí a mim o artigo do Odontobox360 que diz
"os produtos e serviços do catálogo". Estava errado: aquela frase é o texto
literal da interface, igual nos três apps, e o artigo está fiel.

O defeito meu era outro, e real: o digesto que o extrator manda ao modelo
descartava a interpolação do vocabulário, então das 32 telas documentadas
nenhuma devolveu um único marcador, embora a instrução peça. O efeito era o
artigo publicar a palavra do app base nos três. Corrigido em 21/11/2026 — o
digesto da tela de catálogo agora entrega `{{Servico}}` onde antes não entregava
nada. Os artigos só refletem a correção na próxima documentação das telas.
