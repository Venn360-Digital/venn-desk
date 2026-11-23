/**
 * Inclui um app novo no Venn Desk (Fase 8: "em menos de um dia").
 *
 * O que ele faz: cadastra o app, gera a credencial do MCP e imprime o ROTEIRO
 * do que falta — os passos que exigem painel de terceiro (Slack, Cloudflare,
 * GitHub) ou o repositório do outro lado.
 *
 * O que ele NÃO faz, de propósito:
 *
 * - **não gera o par de chaves do app.** A chave privada que assina o JWT mora
 *   no app, não aqui; gerá-la neste script significaria ela passar por esta
 *   máquina e por este terminal. O app gera e nos entrega a PÚBLICA.
 * - **não liga o atendimento automático.** Todo app nasce em modo sombra, com a
 *   IA escrevendo rascunho e humano enviando (seção 4). Ligar é decisão depois
 *   de ver os números, no Console.
 * - **não cria canal no Slack nem webhook no GitHub.** Os dois exigem painel, e
 *   o roteiro diz exatamente o que fazer.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/incluir-app.mjs \
 *     --slug clinicax --nome "ClinicaX360" --prefixo CLX \
 *     --jwk ./chave-publica.json --url https://clinicax.venn360.com
 */
import { readFileSync } from 'node:fs'

import { cadastrarApp } from '../src/dados/apps.ts'
import { criarCliente, descartarCliente } from '../src/dados/cliente.ts'

function argumento(nome) {
    const i = process.argv.indexOf(`--${nome}`)
    return i < 0 ? undefined : process.argv[i + 1]
}

const banco = process.env.DATABASE_URL
if (banco === undefined || banco === '') {
    console.error('defina DATABASE_URL (use o papel de MIGRADOR: este script cria linha nova)')
    process.exit(1)
}

const slug = argumento('slug')
const nome = argumento('nome')
const prefixo = argumento('prefixo')
const caminhoDaJwk = argumento('jwk')

if (slug === undefined || nome === undefined || prefixo === undefined || caminhoDaJwk === undefined) {
    console.error('uso: --slug <slug> --nome <nome> --prefixo <ABC> --jwk <arquivo.json> [--url <url>] [--repo <dono/nome>] [--pasta <apps/x>]')
    process.exit(2)
}

/// O prefixo aparece em todo número de chamado (`CLX-1042`) e não muda depois:
/// mudá-lo quebraria a referência de todos os chamados já abertos.
if (!/^[A-Z]{2,5}$/.test(prefixo)) {
    console.error('o prefixo tem de ser de 2 a 5 letras maiúsculas (ele entra em CLX-1042 e não muda depois)')
    process.exit(2)
}

let chavePublicaJwk
try {
    chavePublicaJwk = JSON.parse(readFileSync(caminhoDaJwk, 'utf8'))
} catch (erro) {
    console.error(`não consegui ler a JWK em ${caminhoDaJwk}:`, erro.message)
    process.exit(2)
}

/**
 * A chave tem de ser PÚBLICA. Uma privada aqui significaria que ela passou pelo
 * nosso banco, e o desenho inteiro depende de ela nunca sair do app.
 */
if (chavePublicaJwk.d !== undefined) {
    console.error('essa JWK é PRIVADA (tem o campo "d"). Peça ao app a chave pública.')
    process.exit(2)
}

const cliente = criarCliente(banco)

try {
    const app = await cadastrarApp(cliente, {
        slug,
        nome,
        prefixo,
        chavePublicaJwk,
        ...(argumento('url') === undefined ? {} : { urlApp: argumento('url') }),
        ...(argumento('repo') === undefined ? {} : { repositorio: argumento('repo') }),
        ...(argumento('pasta') === undefined ? {} : { pastaNoRepositorio: argumento('pasta') }),
    })

    console.log(`\n✓ App cadastrado: ${app.nome} (${app.slug}), prefixo ${app.prefixo}`)
    console.log(`  modo sombra: ${app.modoSombra ? 'LIGADO' : 'desligado'} · atendimento automático: ${app.atendimentoAutomatico ? 'ligado' : 'DESLIGADO'}`)

    console.log(`
O que falta, em ordem — cada passo é de um painel diferente:

1. CREDENCIAL DO MCP (Console → Credenciais)
   Crie uma chave de escopo SUPORTE para o canal de atendimento. Para o canal
   de engenharia, outra, de escopo ENGENHARIA. Uma por canal: é a separação que
   impede um chamado de alcançar o repositório.

2. SAÚDE (Console → Apps)
   Preencha a URL de saúde do app. Sem ela a página de status mostra
   "desconhecido" e o cão de guarda não tem o que sondar.

3. SLACK (painel do Slack + Console → Apps)
   Crie \`#desk-${slug}\` e \`#eng-${slug}\`, privados, convide o Bridge
   (/invite) e cadastre os IDS dos canais no Console. O passo a passo completo
   está em docs/slack-bridge.md.

4. BASE VIVA (Console → Apps)
   Repositório e pasta do app no monorepo. Com os dois preenchidos, a
   sincronização roda sozinha em até uma hora e a base nasce cheia.

5. WIDGET (no app, não aqui)
   Instale o \`packages/desk-widget\` apontando para este Desk, assinando o JWT
   com a chave PRIVADA que ficou com vocês. A pública já está cadastrada.

6. SÓ DEPOIS: atendimento automático
   O app nasce em modo sombra. Ligue no Console quando os números justificarem
   — a seção 4 sugere 90% de envio sem edição em 30 chamados seguidos.
`)
} finally {
    await descartarCliente(cliente)
}
