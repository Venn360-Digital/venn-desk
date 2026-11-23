# Revisão de segurança — 23/11/2026

Revisão dos pontos da seção 10 contra o código que está em produção. Cada linha
foi verificada, não assumida.

## O que está cumprido

| Defesa (seção 10) | Onde | Como foi verificado |
| --- | --- | --- |
| Texto do usuário nunca entra em mensagem do Slack | `slack/mensagens.ts` | A mensagem de abertura leva assunto rotulado e neutralizado; teste prova que nome e e-mail do solicitante não entram |
| Canal de suporte sem repositório | `mcp/ferramentas.ts` | `escopos` por ferramenta; as de engenharia não existem no escopo SUPORTE |
| Credencial do MCP por app | `dados/mcp.ts`, `rotas/mcp.ts` | A chave carrega `appId`, e o escopo do app vem dela — não do pedido |
| Nenhuma ferramenta aprova nem publica | `slack/ponte.ts` | `decidirPortaoDaIssue` exige GESTOR ou ADMIN; teste prova que AGENTE é recusado |
| Anexo por lista de tipos aceitos, com teto | `rotas/solicitante.ts` | Lista positiva (imagem, PDF, vídeo, texto) e 10 MB por arquivo |
| Assinatura em toda entrada | `slack/assinatura.ts`, `github/assinatura.ts`, `auth/token-app.ts` | Tempo constante nas duas; falha FECHADA sem segredo; 13 testes |
| Isolamento entre apps e tenants | `dados/escopo.ts` | `scripts/lint-isolamento.mjs` reprova consulta fora do escopo; roda no portão |
| Trilha de toda ação da IA | `ticket_events` | Ferramenta, parâmetros e custo por chamada |
| Segredos fora do repositório | — | `git grep` por `xoxb-`, `sk-ant-` e blocos de chave privada: só menções em comentário e chave falsa de teste |

## O que foi corrigido nesta revisão

**1. O resumo que ia ao canal de engenharia não era anonimizado.**

O resumo do N1 é escrito pela IA, não pelo cliente — e era exatamente por isso
que passava livre: a regra "texto de cliente não vai ao Slack" não o alcançava. 
Mas o modelo lê o chamado, que tem e-mail e telefone, e resume. "A cliente
maria@x.com não consegue salvar" é um resumo correto e um dado pessoal num canal
que tem o repositório ligado.

Corrigido em `engenharia/ao-escalar.ts`: resumo, título do defeito e proposta de
correção passam por `anonimizar` antes de sair. O mesmo vale para o resumo que
vai ao modelo no diagnóstico do N2 — o que não entra no prompt não volta na
resposta.

**2. Só a abertura de chamado tinha limite de requisições.**

Mensagem, anexo e CSAT não tinham. Dez megabytes por arquivo sem limite de
arquivos era um laço de upload esperando acontecer.

Corrigido em `rotas/solicitante.ts`, com chave de limitador por AÇÃO: quem está
mandando mensagem depressa não perde o direito de abrir um chamado novo, que pode
ser outro problema.

## O que fica em aberto, e por quê

**Mascaramento automático de CPF, telefone e e-mail no texto que vai para
issue.** O detector existe (`conhecimento/privacidade.ts`) e já é usado na
biblioteca de casos e agora no Slack. Falta aplicá-lo na criação da issue — que
ainda não existe, porque depende do GitHub App ganhar escrita.

**Teto de gasto no Claude Tag.** O teto do Desk existe e avisa em
`#desk-alertas`; o do Claude Tag é configuração do workspace do Slack, no painel
da Anthropic.

**Tarja na captura de tela.** A seção 10 propõe uma ferramenta de tarja no
anexo. Hoje o widget não captura tela automaticamente, então não há o que tarjar
— quando capturar, a tarja é requisito, não melhoria.

**Suboperadores no contrato.** Slack, GitHub e Anthropic tratam dado de
suporte. Isso é contrato e lista de suboperadores por app, não código.

## Teste de carga

Em `scripts/carga.mjs`. Ele mede as rotas de LEITURA com concorrência e, só com
`--escrever`, abre chamados marcados `[carga]` num app de homologação.

A separação é deliberada: um teste de carga que escreve em produção deixa
rastro permanente, porque aqui nada é apagado. Leitura mede o que interessa na
prática — a fila do Console e a página de status são o que todo mundo abre ao
mesmo tempo quando algo dá errado.

### Medido em 23/11/2026

| Ambiente | Requisições | Paralelo | req/s | mediana | p90 | p99 | erros 5xx |
| --- | --- | --- | --- | --- | --- | --- | --- |
| staging | 60 | 10 | 16,3 | 251 ms | 1.093 ms | 1.759 ms | 0 |
| produção | 120 | 20 | 23,3 | 629 ms | 944 ms | 1.281 ms | 0 |

Zero erro de servidor nos dois. A mediana de 629 ms em produção é a página de
status com banco acordando: cada rota de status faz duas consultas, e o Neon
suspende a computação depois de minutos sem uso. Em uso contínuo a mediana cai,
e é por isso que o número do p99 importa mais aqui — ele é o pior caso de quem
abre a página no minuto em que algo deu errado.
