# ADR 0006 — Dois portões humanos

**Decidido** em 13/11/2026. **Estado:** aceito.

## Decisão
O gestor aprova a issue antes do desenvolvimento. Um humano aprova a promoção
de staging para produção, e o segundo portão é imposto no GitHub — `main`
protegida, merge restrito ao app do Bridge — não só por um botão no Slack.

## Medição de 15/11/2026: a trava não existe ainda

A conta `venn360` é pessoal, no plano gratuito, e o GitHub recusa proteção de
branch e rulesets em repositório privado nesse plano (403 "Upgrade to GitHub Pro
or make this repository public"), tanto no `venn-desk` quanto no `venn-saas`.

Enquanto isso valer, o Portão 2 é só o botão no Slack, o `CODEOWNERS` deste
repositório é indicativo e `main` aceita push direto. O desenho não muda — falta
o plano que o impõe. Recomendado: organização no GitHub no plano Team, que
também atende à exigência de organização do Claude Tag. Pré-requisito da Fase 6.

## A armadilha do dev sozinho (registrada em 15/11/2026)

O GitHub não permite aprovar o próprio PR. Com "require 1 approval" ligado e
uma só pessoa na organização, **todo** PR fica travado — inclusive os de
desenvolvimento normal.

O desenho funciona porque quem abre o PR da correção é o **app do Bridge**, não
o André: um PR de autoria do app pode ser aprovado por ele, e essa aprovação É
o Portão 2. Para os PRs que ele mesmo escreve, a regra precisa de um *bypass
actor* (o papel de administrador do repositório) no ruleset.

Então o ruleset de `main` fica: exigir PR com 1 aprovação, exigir o check do
portão de CI, restringir push ao app do Bridge, bloquear force push — e o
administrador como bypass. O app do Bridge **nunca** entra como bypass: é
contra ele que a regra existe.

## Consequências
Nenhuma credencial da IA escreve na branch de produção. A variante mais rígida
(environment com revisor obrigatório) não se aplica, porque dependia de deploy
pelo GitHub Actions. `CODEOWNERS` cobre caminhos sensíveis e o próprio portão
de CI.
