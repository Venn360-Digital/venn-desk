# ADR 0010 — A página de status: GitHub Pages, sem framework, sem veredito assado

**Data:** 17/11/2026
**Estado:** aceito
**Substitui parcialmente:** a linha "Astro em build estático" da seção 3

## Contexto

A seção 7 exige que a página de status fique **fora da Cloudflare**: o Venn Desk
e os apps compartilham Cloudflare e Neon, e uma pane de um desses fornecedores
derruba os dois ao mesmo tempo. Uma página servida pela Cloudflare não serviria
para nada exatamente no momento em que ela é mais lida.

A seção 3 dizia "Astro em build estático, hospedada no GitHub Pages". Ao
implementar, três restrições do projeto se encontraram:

1. **Sem GitHub Actions** (ADR 0007). O Pages servindo de uma branch não roda
   build; serve os arquivos como estão.
2. O portão de CI instala as dependências do repositório **a cada push**. Astro
   para quatro páginas custaria ~200 pacotes nessa instalação.
3. A página precisa funcionar quando tudo mais falhou. Quanto menos ela depende,
   melhor.

## Decisão

**Hospedagem:** branch `gh-pages` do próprio `venn-desk`, publicada por
`scripts/publicar-status.mjs` desta máquina. O repositório continua privado e o
site é público — no plano Team, Pages de repositório privado é servido
publicamente, que é o recorte desejado: fonte fechada, página aberta.
URL: `https://venn360-digital.github.io/venn-desk/`.

**Geração:** `status/montar.mjs`, zero dependências. Os textos ficam em
`status/textos.mjs`, nas três línguas dos e-mails, e o idioma é escolhido no
navegador do visitante — a página é UMA para todos, porque é estática.

**O estado nunca é assado no HTML.** O HTML sai sem veredito e consulta
`/api/status` ao abrir. Congelar o estado no build faria a página dizer
"operacional" porque foi gerada ontem, que é pior que não ter página. Quando a
consulta falha, a página **diz que falhou** e nomeia os três sistemas como "não
foi possível verificar". Há prova automatizada de que nenhum `data-estado`
aparece no HTML gerado.

**CORS** foi aberto no Worker apenas para as origens da página. Ele não protege
o endpoint — cliente que não é navegador ignora CORS —; a defesa do `/afetado`
é o teto por e-mail e a resposta idêntica para e-mail conhecido e desconhecido.

## Consequências

- Astro continua sendo a escolha certa se a página crescer (mais apps, histórico
  longo, componentes). A estrutura aqui — dados separados, uma função que
  renderiza — torna a migração mecânica. **Esta decisão é sobre escala, não
  sobre preferência.**
- A publicação depende desta máquina. É aceitável porque a página muda quando o
  cadastro de apps muda, não quando há incidente: o incidente ela lê ao vivo.
- **O que ainda não está coberto:** se a Cloudflare inteira cair, a página abre
  mas não alcança a API, e mostra o aviso honesto em vez do incidente. Fechar
  isso exige o Worker gravar um retrato do incidente na própria `gh-pages` ao
  abri-lo, o que precisa de um token do GitHub com escrita. Fica para quando a
  ponte do Slack trouxer o app do GitHub.
- O domínio `status.venn360.com` exige CNAME **DNS-only**. Proxiado pela
  Cloudflare, ele devolveria a página para dentro do fornecedor do qual ela foge.
