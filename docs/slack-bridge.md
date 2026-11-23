# Cadastro do app do Slack (o Bridge)

O código da ponte está no ar nos dois ambientes. O que falta é o cadastro no
Slack, que exige o painel deles e os dois segredos no Worker.

Nada aqui pode ser feito por mim: `wrangler secret put` é barrado nesta máquina
e o painel do Slack é seu.

## 1. Os canais

Privados, sem convidados externos (seção 8 da especificação):

| Canal | Para quê |
| --- | --- |
| `#desk-odontobox`, `#desk-conecta`, `#desk-stagent` | uma thread por chamado |
| `#eng-odontobox`, `#eng-conecta`, `#eng-stagent` | uma thread por defeito |
| `#desk-aprovacoes` | pedidos de aprovação, só o Bridge posta |
| `#desk-alertas` | SLA em risco, cão de guarda, resumo diário |

`#desk-alertas` já recebe: queda e volta de app, prazo estourado e cão de
guarda, uma linha com sinal na frente. `#desk-aprovacoes` e os canais `#eng-*`
ainda não recebem nada — eles entram com a Fase 5, quando houver issue e deploy
a aprovar. Criá-los agora evita uma segunda rodada de permissões depois.

## 2. O app

Em `api.slack.com/apps`, "From scratch", nome **Venn Desk Bridge**.

**OAuth & Permissions**, escopos de bot:

| Escopo | Por quê |
| --- | --- |
| `chat:write` | postar a thread do chamado |
| `commands` | `/desk vincular` |
| `users:read` e `users:read.email` | o e-mail que liga a conta ao agente |
| `reactions:read` | 👀 assume, ✅ resolve |
| `groups:history` e `groups:read` | ler mensagens de canal PRIVADO |

`channels:history` serve para canal público e não é necessário se todos os
canais forem privados, como a especificação pede.

**Event Subscriptions**, URL de requisição:

```
https://desk.venn360.com/slack/eventos
```

A verificação responde na hora: o handshake não exige assinatura, e é o único
caminho que responde sem ela (está documentado em `src/rotas/slack.ts`).
Eventos a assinar, em "Subscribe to bot events": `message.groups` e
`reaction_added`.

**Interactivity & Shortcuts**, URL:

```
https://desk.venn360.com/slack/interativo
```

**Slash Commands**, novo comando `/desk`, URL:

```
https://desk.venn360.com/slack/comandos
```

Descrição: "vincula a sua conta do Slack ao Venn Desk".

Depois instale no workspace e convide o bot em cada canal (`/invite @Venn Desk
Bridge`).

## 3. Os dois segredos, nos dois ambientes

O signing secret está em "Basic Information"; o token do bot (`xoxb-…`) em
"OAuth & Permissions". Rode os quatro comandos e cole o valor quando o wrangler
pedir, sem passá-lo por argumento:

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
```

```bash
npx wrangler secret put SLACK_BOT_TOKEN
```

```bash
npx wrangler secret put SLACK_SIGNING_SECRET --env producao
```

```bash
npx wrangler secret put SLACK_BOT_TOKEN --env producao
```

Sem os dois, a ponte falha FECHADA: nenhuma requisição é aceita e nada é
postado. É o comportamento certo, e não um bug a investigar.

## 4. Os ids dos canais no Console

Console → Apps, campo "Canal de suporte (id, C…)" de cada app. O id está em
"Ver detalhes do canal", no fim da aba Sobre. É o id e não o nome de propósito:
o nome muda quando alguém renomeia o canal, e a ponte perderia o vínculo em
silêncio.

## 5. Cada atendente digita `/desk vincular`

Uma vez, em qualquer canal. Sem isso as ações dele no Slack não têm autoria e a
ponte as ignora: nota interna sem autor, botão que não age, reação que não
resolve.

## 6. O canal de alertas

Em `wrangler.jsonc`, em `vars`, nos dois ambientes:

```jsonc
"SLACK_CANAL_DE_ALERTAS": "C0ALERTAS"
```

É o id de `#desk-alertas`. Um canal para os três apps: quem olha alerta está de
plantão sobre a plataforma, não sobre um produto, e o nome do app vai na linha.
Ausente, nenhum alerta é postado e o e-mail continua sendo o aviso — não é
defeito, é o estado inicial.

## 7. A menção que acorda o Claude (opcional)

Só para app com atendimento automático ligado. Em `wrangler.jsonc`, em `vars`:

```jsonc
"SLACK_MENCAO_DO_CLAUDE": "<@U07CLAUDE>"
```

É um id público do workspace, não um segredo. Ausente, a mensagem de abertura
sai sem menção e ninguém é acordado — que é o estado seguro.

## Como saber que funcionou

1. Abra um chamado pelo widget em homologação. Em segundos aparece a thread no
   canal, com cinco botões e sem o texto do solicitante colado.
2. Escreva na thread. A mensagem vira **nota interna** no chamado, visível no
   Console, com o seu nome.
3. Clique em "Responder ao usuário". Abre um modal avisando que aquilo chega ao
   cliente. O que você enviar aparece no widget (ou fica rascunho, se o app
   estiver em modo sombra).
4. Reaja com 👀 na primeira mensagem da thread: o chamado fica atribuído a você.
   Com ✅: resolvido.

Se nada acontecer, o log do Worker diz por quê em uma linha (`wrangler tail`).
Os motivos possíveis estão todos nomeados: `sem_canal`, `sem_token`,
`autor_nao_cadastrado`, `thread_sem_chamado`, `nao_e_a_raiz`, `reentrega`.

## Webhook do GitHub (Fase 5)

O endpoint está no ar. Em `github.com/Venn360-Digital/venn-saas/settings/hooks`,
"Add webhook":

- **Payload URL**: `https://desk.venn360.com/github/webhook`
- **Content type**: `application/json`
- **Secret**: gere um valor aleatório e guarde; ele vai para o Worker abaixo
- **Eventos**: `Issues`, `Pull requests`, `Check runs`, `Check suites`,
  `Workflow runs`, `Deployment statuses`

`Check runs` é o que importa mais, e não é óbvio: o **Workers Builds não emite
`deployment_status`**. Ele reporta ao GitHub por check run e por comentário de
PR, e como é ele que publica os apps, é o check run dele que anuncia o deploy. O
Desk reconhece o app `cloudflare-workers-and-pages` e usa a branch para saber o
ambiente: `main` é produção, qualquer outra é homologação.

Depois, nos dois ambientes:

```bash
npx wrangler secret put GITHUB_WEBHOOK_SEGREDO
```

```bash
npx wrangler secret put GITHUB_WEBHOOK_SEGREDO --env producao
```

Sem o segredo, nenhum evento é aceito — falha fechada, como no Slack.

**A convenção que faz o vínculo funcionar**: a branch da correção precisa citar
o chamado, como `desk/ODB-1042`. O título ou o corpo da issue também servem. Sem
a referência o evento é ignorado com uma linha no log, porque não há como saber
a que chamado ele pertence — e todo evento do GitHub tem números soltos que não
são chamado nenhum.

## O canal de aprovações (Portão 1)

Em `wrangler.jsonc`, em `vars`, nos dois ambientes:

```jsonc
"SLACK_CANAL_DE_APROVACOES": "C0APROVACOES"
```

É o id de `#desk-aprovacoes`. Um canal para os três apps: quem aprova decide
sobre a plataforma, e um canal por produto espalharia a decisão em três lugares
que ninguém acompanha junto.

Quem decide precisa ter papel **GESTOR** ou **ADMIN** no Venn Desk, além de ter
feito `/desk vincular`. Um agente de nível 1 clicando em "Aprovar" recebe uma
recusa silenciosa no log (`sem_papel_de_aprovador`) e nada acontece — é a trava
central do projeto, e ela é conferida no servidor, não no botão.

Sem a variável, o pedido de aprovação continua sendo registrado na linha do
tempo do chamado, e a ferramenta avisa o modelo de que ninguém foi notificado.
