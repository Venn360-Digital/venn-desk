# ADR 0006 — Dois portões humanos

**Decidido** em 13/11/2026. **Estado:** aceito.

## Decisão
O gestor aprova a issue antes do desenvolvimento. Um humano aprova a promoção
de staging para produção, e o segundo portão é imposto no GitHub — `main`
protegida, merge restrito ao app do Bridge — não só por um botão no Slack.

## Consequências
Nenhuma credencial da IA escreve na branch de produção. A variante mais rígida
(environment com revisor obrigatório) não se aplica, porque dependia de deploy
pelo GitHub Actions. `CODEOWNERS` cobre caminhos sensíveis e o próprio portão
de CI.
