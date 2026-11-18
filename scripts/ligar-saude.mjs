/**
 * Liga (ou desliga) a verificação de saúde dos apps, pelo Console.
 *
 * O cron só sonda app que tem `urlSaude` gravada — sem ela o app é pulado em
 * silêncio, que é o estado certo para quem ainda não quer ser acordado.
 *
 * **Pelo Console, e não por UPDATE no banco.** A rota valida o endereço
 * (`url()` recusa caminho relativo: a sondagem sai do Worker do Venn Desk, e
 * endereço sem origem não alcança nada) e deixa o mesmo rastro que deixaria se
 * alguém tivesse clicado na tela. Um UPDATE direto pularia as duas coisas.
 *
 * **Confere antes de gravar.** Ligar monitoramento para um endereço que não
 * responde é agendar um alarme falso para daqui a um minuto — então o script
 * sonda cada URL primeiro e recusa o que não devolver 2xx.
 *
 * Uso:
 *   node scripts/ligar-saude.mjs                      # mostra o que faria
 *   node scripts/ligar-saude.mjs --aplicar            # grava
 *   node scripts/ligar-saude.mjs --aplicar odontobox  # só um app
 *   AMBIENTE=stg node scripts/ligar-saude.mjs         # homologação
 *   node scripts/ligar-saude.mjs --desligar --aplicar # volta ao silêncio
 *
 * A senha do Console sai do cofre, nunca do ambiente nem da linha de comando,
 * e não é impressa.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AMBIENTE = process.env.AMBIENTE ?? 'production'

const BASES = {
    production: 'https://desk.venn360.com',
    stg: 'https://venn-desk.andre-7ee.workers.dev',
}

/**
 * O endereço de cada app, por ambiente.
 *
 * `urlSaude` aponta para `/api/health` e `urlApp` para a raiz: o primeiro é o
 * que a sondagem consulta, o segundo é o que vai no e-mail de alerta e na
 * página de status, para quem recebe poder abrir o app e ver com os próprios
 * olhos.
 */
const APPS = {
    production: {
        odontobox: 'https://odontobox.venn360.com',
        conecta: 'https://conecta.venn360.com',
        stagent: 'https://stagent.venn360.com',
    },
    stg: {
        odontobox: 'https://homolog-odontobox.venn360.com',
        conecta: 'https://homolog-conecta.venn360.com',
        stagent: 'https://homolog-stagent.venn360.com',
    },
}

const BASE = BASES[AMBIENTE]
if (BASE === undefined) {
    console.error(`AMBIENTE deve ser production ou stg (recebido: ${AMBIENTE})`)
    process.exit(2)
}

const argumentos = process.argv.slice(2)
const APLICAR = argumentos.includes('--aplicar')
const DESLIGAR = argumentos.includes('--desligar')
const ESCOLHIDOS = argumentos.filter((a) => !a.startsWith('--'))

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

/** Uma sondagem igual à do cron, para não ligar alarme sobre endereço morto. */
async function responde(url) {
    const controle = new AbortController()
    const corta = setTimeout(() => controle.abort(), 8_000)
    try {
        const r = await fetch(url, { signal: controle.signal, redirect: 'follow' })
        return { ok: r.ok, detalhe: String(r.status) }
    } catch (erro) {
        return { ok: false, detalhe: erro.name === 'AbortError' ? 'tempo esgotado' : erro.message }
    } finally {
        clearTimeout(corta)
    }
}

async function main() {
    const alvos = Object.entries(APPS[AMBIENTE]).filter(
        ([slug]) => ESCOLHIDOS.length === 0 || ESCOLHIDOS.includes(slug)
    )
    if (alvos.length === 0) {
        console.error(`Nenhum app casa com ${ESCOLHIDOS.join(', ')}.`)
        process.exit(2)
    }

    console.log(`${DESLIGAR ? 'Desligando' : 'Ligando'} a saúde em ${AMBIENTE} (${BASE})\n`)

    const cabecalho = await entrar()

    const { apps } = await fetch(`${BASE}/api/console/apps`, { headers: cabecalho }).then((r) =>
        r.json()
    )
    const antes = new Map(apps.map((a) => [a.slug, a.urlSaude ?? null]))

    let falhas = 0

    for (const [slug, raiz] of alvos) {
        const saude = `${raiz}/api/health`
        const atual = antes.get(slug) ?? '—'

        if (!DESLIGAR) {
            const sonda = await responde(saude)
            if (!sonda.ok) {
                console.log(`  ✗ ${slug.padEnd(10)} ${saude} → ${sonda.detalhe}; não ligo`)
                falhas += 1
                continue
            }
        }

        const corpo = DESLIGAR ? { urlSaude: null } : { urlSaude: saude, urlApp: raiz }

        if (!APLICAR) {
            console.log(`  · ${slug.padEnd(10)} ${atual}  →  ${corpo.urlSaude ?? '—'}`)
            continue
        }

        const r = await fetch(`${BASE}/api/console/apps/${slug}`, {
            method: 'PATCH',
            headers: { ...cabecalho, 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        })

        if (r.ok) {
            console.log(`  ✓ ${slug.padEnd(10)} ${atual}  →  ${corpo.urlSaude ?? '—'}`)
        } else {
            console.log(`  ✗ ${slug.padEnd(10)} o Console recusou (${r.status}): ${await r.text()}`)
            falhas += 1
        }
    }

    if (!APLICAR) {
        console.log('\nNada foi gravado. Repita com --aplicar.')
        return
    }

    if (falhas > 0) process.exitCode = 1

    if (!DESLIGAR && falhas === 0) {
        console.log(
            '\nO cron sonda a cada minuto. Uma falha isolada NÃO derruba nada:\n' +
                'são precisas duas seguidas (LIMITE_DE_FALHAS), porque uma sondagem\n' +
                'sozinha não distingue "o app caiu" de "esta requisição caiu".\n' +
                'Na segunda, abre chamado urgente e sai e-mail para GESTOR e ADMIN.'
        )
    }
}

await main()
