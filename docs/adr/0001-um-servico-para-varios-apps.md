# ADR 0001 — Um serviço, vários apps

**Decidido** em 13/11/2026. **Estado:** aceito.

## Contexto
Três produtos da mesma base precisam de suporte, e a exigência de isolamento
total entre eles já governa banco, filas e Workers.

## Decisão
Um único Venn Desk, em repositório, Worker e banco próprios. Cada app é um
registro (`app_id`). Incluir um app é cadastrar, instalar o widget e criar o
canal no Slack.

## Consequências
Nenhum app compartilha banco com outro, e o isolamento passa a ser filtro por
`app_id` dentro do Desk — o que exige teste de isolamento em toda rota. Uma
pane do Desk afeta o suporte dos três ao mesmo tempo; a página de status mora
fora da Cloudflare por isso.

## Alternativa rejeitada
Um help desk por app: triplica operação, configuração e custo de IA, e não dá
visão cruzada de defeito que existe nos três.
