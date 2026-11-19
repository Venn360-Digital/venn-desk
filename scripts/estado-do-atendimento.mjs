/**
 * Como cada app está configurado para atender — e o que isso significa.
 *
 * Existe porque três chaves decidem, juntas, se a IA fala sozinha com o
 * cliente, e elas moram em telas diferentes do Console. Antes do primeiro
 * tráfego real, saber a combinação importa mais que saber cada uma:
 *
 *   atendimentoAutomatico=false  → a IA só age quando alguém clica "Atender".
 *   automático + modoSombra      → ela escreve, e alguém aprova antes de sair.
 *   automático sem sombra        → ela responde direto ao cliente.
 *
 * Só LÊ. Nada aqui altera nada — mudar é na tela Apps do Console, com gente
 * decidindo.
 *
 *   AMBIENTE=production node scripts/estado-do-atendimento.mjs
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AMBIENTE = process.env.AMBIENTE ?? 'production'

const BASES = {
    production: 'https://desk.venn360.com',
    stg: 'https://venn-desk.andre-7ee.workers.dev',
}

const BASE = BASES[AMBIENTE]
if (BASE === undefined) {
    console.error(`AMBIENTE deve ser production ou stg (recebido: ${AMBIENTE})`)
    process.exit(2)
}

function senhaDoConsole() {
    const arquivo = join(homedir(), '.venn360-secrets/venn-desk', `worker-${AMBIENTE}.env`)
    const linha = readFileSync(arquivo, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('export CONSOLE_SENHA_INICIAL='))
    if (linha === undefined) throw new Error(`CONSOLE_SENHA_INICIAL não está em ${arquivo}`)
    return linha.slice('export CONSOLE_SENHA_INICIAL='.length).trim().replace(/^['"]|['"]$/g, '')
}

async function entrar() {
    const r = await fetch(`${BASE}/api/console/sessao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@venn360.com', senha: senhaDoConsole() }),
    })
    const sessao = /venn_desk_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]
    if (!r.ok || sessao === undefined) throw new Error(`login falhou: ${r.status}`)
    return { Authorization: `Bearer ${sessao}` }
}

/** O que a combinação das três chaves significa para quem abre um chamado. */
function leitura(app) {
    if (!app.atendimentoAutomatico) {
        return ['manual', 'a IA só age quando alguém clica "Atender" no Console']
    }
    if (app.modoSombra) {
        return ['sombra', 'a IA escreve e alguém aprova antes de sair']
    }
    return ['AO VIVO', 'a IA responde direto ao cliente, sem revisão']
}

async function main() {
    const cabecalho = await entrar()

    const { apps } = await fetch(`${BASE}/api/console/apps`, { headers: cabecalho }).then((r) =>
        r.json()
    )

    console.log(`Atendimento em ${AMBIENTE} (${BASE})\n`)
    console.log('  app          modo      saúde   base   o que acontece')

    let aoVivo = 0
    let semBase = 0

    for (const app of apps) {
        const [modo, explicacao] = leitura(app)
        if (modo === 'AO VIVO') aoVivo += 1

        /// A base vazia é o outro lado da mesma moeda: a IA pode estar ligada e
        /// não ter o que responder além do que o modelo sabe.
        const { artigos } = await fetch(`${BASE}/api/console/app/${app.slug}/base`, {
            headers: cabecalho,
        }).then((r) => r.json())
        const publicados = artigos.filter((a) => a.status === 'PUBLICADO').length
        if (publicados === 0) semBase += 1

        console.log(
            `  ${app.slug.padEnd(12)} ${modo.padEnd(9)} ${(app.urlSaude ? 'sim' : '—').padEnd(7)} ${String(publicados).padEnd(6)} ${explicacao}`
        )
    }

    if (aoVivo > 0) {
        console.log(
            `\n⚠ ${aoVivo} app(s) com a IA respondendo AO VIVO.\n` +
                '  Antes do primeiro tráfego real, o modo sombra é o que permite ver o que ela\n' +
                '  escreveria sem que o cliente leia. Troca-se na tela Apps do Console.'
        )
    }

    if (semBase > 0) {
        console.log(
            `\n⚠ ${semBase} app(s) sem NENHUM artigo publicado.\n` +
                '  Sem base e sem chamado antigo, a IA responde só com o que o modelo sabe e\n' +
                '  com o que a pessoa escreveu. Artigo é o que torna a resposta da EMPRESA.'
        )
    }
}

await main()
