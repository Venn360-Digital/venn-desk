/**
 * O gerador da página de status — item 2 da contingência (seção 7).
 *
 * **Por que estática, e por que fora da Cloudflare.** O Venn Desk e os apps
 * compartilham Cloudflare e Neon. Uma pane de um desses fornecedores derruba os
 * dois, e nesse momento uma página servida pela Cloudflare não serviria para
 * nada. Então ela é HTML pronto, hospedado no GitHub Pages: mesmo com o Worker
 * fora, o navegador do cliente abre a página e lê a frase que importa.
 *
 * **Por que sem framework.** A especificação diz Astro, e Astro é a escolha
 * certa quando a página crescer (mais apps, mais textos, componentes). Hoje ela
 * é um índice e uma página por app, e o projeto não usa GitHub Actions — então
 * o build acontece nesta máquina e o resultado é empurrado. Com zero
 * dependências, esse build não pode quebrar por causa de instalação, e o
 * `package.json` do Worker não ganha 200 pacotes que o portão de CI instala a
 * cada push. A estrutura aqui (dados separados, uma função que renderiza) é a
 * mesma que um componente Astro teria, e a migração é mecânica.
 *
 * **O estado vem do navegador do visitante, não do build.** Gerar o estado no
 * HTML o congelaria no instante do build — uma página de status que diz
 * "operacional" porque foi gerada ontem é pior que nenhuma. Então o HTML sai
 * sem veredito e a página consulta `/api/status` ao abrir. Quando essa consulta
 * falha, ela diz que falhou. Nunca inventa "operacional".
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { IDIOMAS, TEXTOS } from './textos.mjs'

const RAIZ = dirname(new URL(import.meta.url).pathname)
const SAIDA = join(RAIZ, 'dist')

/// A API que a página consulta. Vem do ambiente para o build de produção
/// apontar para `desk.venn360.com` sem editar código.
const API = process.env.API_STATUS ?? 'https://venn-desk.andre-7ee.workers.dev'

/**
 * O portal de contingência (seção 7, item 4: "como o cliente chega lá").
 *
 * Mora no Worker, e isso é coerente: o portal existe para quando o APP está
 * fora, não para quando a Cloudflare está. Quando a Cloudflare cai, a página de
 * status ainda abre e diz que não alcançou o Venn Desk — que é a informação
 * verdadeira naquele instante, e é mais do que o cliente teria sem ela.
 */
const PORTAL = process.env.URL_DESK ?? API

/**
 * Os apps da página. Ficam AQUI e não vêm da API de propósito: a lista precisa
 * existir no HTML para a página abrir e nomear os sistemas mesmo quando a API
 * está inalcançável — que é exatamente o caso em que ela é mais lida.
 */
const APPS = [
    { slug: 'odontobox', nome: 'Odontobox360' },
    { slug: 'conecta', nome: 'Conecta360' },
    { slug: 'stagent', nome: 'Stagent360' },
]

const escapar = (texto) =>
    String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

const ESTILO = `
:root{color-scheme:light dark;--fundo:#fbfbfc;--papel:#fff;--borda:#e4e4e7;--texto:#18181b;--fraco:#71717a;--bom:#15803d;--bomFundo:#dcfce7;--ruim:#b91c1c;--ruimFundo:#fee2e2;--neutro:#52525b;--neutroFundo:#f4f4f5;--aviso:#92400e;--avisoFundo:#fef3c7}
@media (prefers-color-scheme:dark){:root{--fundo:#09090b;--papel:#18181b;--borda:#27272a;--texto:#fafafa;--fraco:#a1a1aa;--bom:#4ade80;--bomFundo:#14321f;--ruim:#f87171;--ruimFundo:#3b1414;--neutro:#a1a1aa;--neutroFundo:#27272a;--aviso:#fbbf24;--avisoFundo:#3a2a09}}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.envelope{max-width:46rem;margin:0 auto;padding:3rem 1.25rem 4rem}
h1{font-size:1.5rem;letter-spacing:-.01em;margin:0 0 .35rem}
h2{font-size:1.05rem;margin:2.5rem 0 .75rem}
.sub{color:var(--fraco);margin:0 0 2rem;font-size:.9rem}
.cartao{background:var(--papel);border:1px solid var(--borda);border-radius:.7rem;padding:1rem 1.1rem;margin-bottom:.6rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.cartao .nome{font-weight:600;flex:1;min-width:9rem}
.cartao .quando{color:var(--fraco);font-size:.8rem;width:100%}
.pilula{font-size:.78rem;font-weight:600;padding:.2rem .6rem;border-radius:999px;white-space:nowrap;background:var(--neutroFundo);color:var(--neutro)}
.pilula[data-estado=operacional]{background:var(--bomFundo);color:var(--bom)}
.pilula[data-estado=fora_do_ar]{background:var(--ruimFundo);color:var(--ruim)}
.faixa{background:var(--avisoFundo);color:var(--aviso);border:1px solid currentColor;border-radius:.6rem;padding:.8rem 1rem;margin-bottom:1.5rem;font-size:.88rem}
a{color:inherit}
.link{font-size:.82rem;color:var(--fraco);text-decoration:none;border-bottom:1px solid var(--borda)}
.link:hover{color:var(--texto)}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{text-align:left;padding:.5rem .4rem;border-bottom:1px solid var(--borda)}
th{color:var(--fraco);font-weight:500}
form{background:var(--papel);border:1px solid var(--borda);border-radius:.7rem;padding:1.1rem}
label{display:block;font-size:.82rem;color:var(--fraco);margin-bottom:.3rem}
input{width:100%;padding:.55rem .7rem;border:1px solid var(--borda);border-radius:.45rem;background:var(--fundo);color:var(--texto);font-size:1rem}
button{margin-top:.7rem;padding:.55rem 1rem;border:0;border-radius:.45rem;background:var(--texto);color:var(--fundo);font-size:.9rem;font-weight:600;cursor:pointer}
button[disabled]{opacity:.55;cursor:default}
.botao{display:inline-block;padding:.55rem 1rem;border-radius:.45rem;background:var(--texto);color:var(--fundo);font-size:.9rem;font-weight:600;text-decoration:none}
.recado{margin-top:.7rem;font-size:.85rem;color:var(--fraco)}
footer{margin-top:3rem;color:var(--fraco);font-size:.75rem}
`.trim()

/** O roteiro da página, igual nas duas telas. Só os dados mudam. */
const SCRIPT = (modo) => `
const API=${JSON.stringify(API)}
const T=${JSON.stringify(TEXTOS)}
const IDIOMAS=${JSON.stringify(IDIOMAS)}
const MODO=${JSON.stringify(modo)}

/// pt-BR é o padrão, e "pt" de qualquer região cai nele.
function idioma(){
  for(const pedido of (navigator.languages||[navigator.language||'pt-BR'])){
    const curto=String(pedido).toLowerCase()
    if(curto.startsWith('pt'))return 'pt-BR'
    if(curto.startsWith('es'))return 'es'
    if(curto.startsWith('en'))return 'en'
  }
  return 'pt-BR'
}
const t=T[idioma()]
document.documentElement.lang=idioma()

for(const no of document.querySelectorAll('[data-t]')){
  const chave=no.getAttribute('data-t')
  if(t[chave]!==undefined)no.textContent=t[chave]
}

const dataHora=(iso)=>new Date(iso).toLocaleString(idioma(),{dateStyle:'short',timeStyle:'short'})
function duracao(de,ate){
  const ms=(ate?new Date(ate):new Date())-new Date(de)
  const min=Math.max(1,Math.round(ms/60000))
  return min<60?min+' '+t.minutos:(Math.floor(min/60)+' '+t.horas+' '+(min%60)+' '+t.minutos)
}

function pintar(slug,linha){
  const cartao=document.querySelector('[data-app="'+slug+'"]')
  if(!cartao)return
  const pilula=cartao.querySelector('.pilula')
  const quando=cartao.querySelector('.quando')
  if(linha===null||linha===undefined){
    pilula.dataset.estado='';pilula.textContent=t.desconhecido;quando.textContent='';return
  }
  if(linha.estado===null){
    pilula.dataset.estado='';pilula.textContent=t.naoMedido;quando.textContent='';return
  }
  pilula.dataset.estado=linha.estado
  pilula.textContent=linha.estado==='operacional'?t.operacional:t.fora
  const partes=[]
  if(linha.desdeEm)partes.push(t.desde+' '+dataHora(linha.desdeEm)+' ('+duracao(linha.desdeEm)+')')
  if(linha.verificadoEm)partes.push(t.verificadoEm+' '+dataHora(linha.verificadoEm))
  quando.textContent=partes.join(' · ')
}

function semAlcance(){
  const faixa=document.getElementById('faixa')
  faixa.textContent=t.semAlcance
  faixa.hidden=false
  for(const cartao of document.querySelectorAll('[data-app]'))pintar(cartao.dataset.app,null)
}

async function carregar(){
  try{
    /// 8 s: a página não pode ficar presa num fetch que nunca volta — o caso
    /// de pane é justamente o fornecedor que aceita a conexão e não responde.
    const r=await fetch(API+(MODO.slug?'/api/status/'+MODO.slug:'/api/status'),
      {signal:AbortSignal.timeout(8000),cache:'no-store'})
    if(!r.ok)throw new Error(r.status)
    const d=await r.json()
    document.getElementById('faixa').hidden=true
    if(MODO.slug){pintar(MODO.slug,d);historico(d.episodios||[]);abrirApp(d.url)}
    else for(const linha of d.apps||[])pintar(linha.app,linha)
  }catch(e){semAlcance()}
}

function abrirApp(url){
  const a=document.getElementById('abrirApp')
  if(a&&url){a.href=url;a.hidden=false}
}

function historico(episodios){
  const corpo=document.getElementById('episodios')
  const vazio=document.getElementById('semHistorico')
  if(!corpo)return
  corpo.innerHTML=''
  vazio.hidden=episodios.length>0
  document.getElementById('tabela').hidden=episodios.length===0
  for(const e of episodios){
    const tr=document.createElement('tr')
    const inicio=document.createElement('td');inicio.textContent=dataHora(e.iniciadoEm)
    const fim=document.createElement('td')
    fim.textContent=e.terminadoEm?dataHora(e.terminadoEm):t.emAberto
    const dur=document.createElement('td');dur.textContent=duracao(e.iniciadoEm,e.terminadoEm)
    tr.append(inicio,fim,dur);corpo.appendChild(tr)
  }
}

const form=document.getElementById('afetado')
if(form)form.addEventListener('submit',async(ev)=>{
  ev.preventDefault()
  const botao=form.querySelector('button')
  const recado=document.getElementById('recado')
  botao.disabled=true;botao.textContent=t.afetadoEnviando;recado.textContent=''
  try{
    const r=await fetch(API+'/api/status/'+MODO.slug+'/afetado',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:form.elements.email.value}),
      signal:AbortSignal.timeout(10000)})
    const d=await r.json()
    /// O recibo vem do servidor e é o MESMO para e-mail conhecido e
    /// desconhecido. A página mostra o que recebeu, sem acrescentar juízo.
    recado.textContent=d.mensagem||t.afetadoErro
    if(r.ok)form.reset()
  }catch(e){recado.textContent=t.afetadoErro}
  finally{botao.disabled=false;botao.textContent=t.afetadoBotao}
})

carregar()
/// Recarrega sozinha: num incidente a aba fica aberta, e um número velho na
/// tela é pior do que nenhum.
setInterval(carregar,60000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)carregar()})
`.trim()

function moldura({ titulo, corpo, modo, prefixo }) {
    const padrao = TEXTOS['pt-BR']
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title>
<meta name="robots" content="noindex">
<style>${ESTILO}</style>
</head>
<body>
<div class="envelope">
<h1 data-t="titulo">${escapar(padrao.titulo)}</h1>
<p class="sub" data-t="subtitulo">${escapar(padrao.subtitulo)}</p>
<div class="faixa" id="faixa" hidden></div>
${corpo}
<footer>Venn360 · <a class="link" href="${prefixo}">${escapar(padrao.voltar)}</a></footer>
</div>
<script>${SCRIPT(modo)}</script>
</body>
</html>
`
}

function indice() {
    const padrao = TEXTOS['pt-BR']
    const cartoes = APPS.map(
        (app) => `<div class="cartao" data-app="${app.slug}">
  <span class="nome">${escapar(app.nome)}</span>
  <span class="pilula">${escapar(padrao.carregando)}</span>
  <a class="link" href="${app.slug}/" data-t="verDetalhes">${escapar(padrao.verDetalhes)}</a>
  <span class="quando"></span>
</div>`
    ).join('\n')

    return moldura({
        titulo: padrao.titulo,
        corpo: cartoes,
        modo: { slug: null },
        prefixo: './',
    })
}

function pagina(app) {
    const padrao = TEXTOS['pt-BR']
    const corpo = `<div class="cartao" data-app="${app.slug}">
  <span class="nome">${escapar(app.nome)}</span>
  <span class="pilula">${escapar(padrao.carregando)}</span>
  <a class="link" id="abrirApp" href="#" data-t="abrirApp" hidden>${escapar(padrao.abrirApp)}</a>
  <span class="quando"></span>
</div>

<h2 data-t="historico">${escapar(padrao.historico)}</h2>
<p class="sub" id="semHistorico" data-t="semHistorico" hidden>${escapar(padrao.semHistorico)}</p>
<table id="tabela" hidden>
  <thead><tr>
    <th data-t="colunaInicio">${escapar(padrao.colunaInicio)}</th>
    <th data-t="colunaFim">${escapar(padrao.colunaFim)}</th>
    <th data-t="colunaDuracao">${escapar(padrao.colunaDuracao)}</th>
  </tr></thead>
  <tbody id="episodios"></tbody>
</table>

<h2 data-t="portalTitulo">${escapar(padrao.portalTitulo)}</h2>
<p class="sub" data-t="portalTexto">${escapar(padrao.portalTexto)}</p>
<p><a class="botao" href="${PORTAL}/portal/${app.slug}" data-t="portalBotao">${escapar(padrao.portalBotao)}</a></p>

<h2 data-t="afetadoTitulo">${escapar(padrao.afetadoTitulo)}</h2>
<form id="afetado">
  <p class="sub" data-t="afetadoTexto" style="margin:0 0 .8rem">${escapar(padrao.afetadoTexto)}</p>
  <label for="email" data-t="afetadoRotulo">${escapar(padrao.afetadoRotulo)}</label>
  <input id="email" name="email" type="email" required autocomplete="email" inputmode="email">
  <button type="submit" data-t="afetadoBotao">${escapar(padrao.afetadoBotao)}</button>
  <p class="recado" id="recado" role="status" aria-live="polite"></p>
</form>`

    return moldura({
        titulo: `${app.nome} · ${TEXTOS['pt-BR'].titulo}`,
        corpo,
        modo: { slug: app.slug },
        prefixo: '../',
    })
}

export function montar(destino = SAIDA) {
    rmSync(destino, { recursive: true, force: true })
    mkdirSync(destino, { recursive: true })

    const arquivos = [['index.html', indice()]]
    for (const app of APPS) arquivos.push([`${app.slug}/index.html`, pagina(app)])
    /// O 404 do Pages é a própria página: quem digita um caminho errado durante
    /// uma pane deve ver o estado, não um erro.
    arquivos.push(['404.html', indice()])
    /// Sem isto o Pages passa tudo pelo Jekyll, que não é o que gera isto.
    arquivos.push(['.nojekyll', ''])

    for (const [caminho, conteudo] of arquivos) {
        const alvo = join(destino, caminho)
        mkdirSync(dirname(alvo), { recursive: true })
        writeFileSync(alvo, conteudo)
    }

    return arquivos.map(([caminho]) => caminho)
}

export { APPS, API }

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const feitos = montar()
    process.stdout.write(`✓ Status: ${feitos.length} arquivos em status/dist\n`)
    for (const f of feitos) process.stdout.write(`    ${f}\n`)
}
