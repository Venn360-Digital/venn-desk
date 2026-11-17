/**
 * Aceite da verificação de saúde (Fase 3, item 1 da contingência).
 *
 * Prova o ciclo inteiro contra o Worker publicado, SEM simular nada: configura
 * os endereços pelo Console, verifica os três apps de pé, derruba um de
 * propósito, confere que a queda só é declarada na SEGUNDA falha, que ela abre
 * problema e episódio, que a página de status publica o incidente, que "também
 * fui afetado" abre chamado para e-mail conhecido e nada para desconhecido, e
 * que a volta fecha o episódio e resolve o problema.
 *
 * A senha do Console sai do cofre em `~/.venn360-secrets/venn-desk/`, nunca do
 * ambiente nem da linha de comando — e não é impressa.
 *
 * Uso: BASE=https://… node scripts/aceite-saude.mjs
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { importJWK, SignJWT } from 'jose'

const BASE = process.env.BASE ?? 'https://venn-desk.andre-7ee.workers.dev'
const AMBIENTE = process.env.AMBIENTE ?? 'stg'

/**
 * Endereço que não alcança ninguém, de propósito: o Workers não faz fetch para
 * o loopback, então a sondagem falha na hora, sem bater em servidor de
 * terceiro e sem depender de DNS inexistente (que uma zona com curinga
 * responderia).
 */
const MORTO = 'http://127.0.0.1:9/'

const APPS = {
    odontobox: 'https://homolog-odontobox.venn360.com',
    conecta: 'https://homolog-conecta.venn360.com',
    stagent: 'https://homolog-stagent.venn360.com',
}
/// O app que vai ser derrubado no teste. O de menor volume.
const COBAIA = 'stagent'

let falhas = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const nao = (t) => {
    falhas += 1
    console.log(`  ✗ ${t}`)
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
    const cookie = r.headers.get('set-cookie') ?? ''
    const sessao = /venn_desk_sessao=([^;]+)/.exec(cookie)?.[1]
    if (!r.ok || sessao === undefined) throw new Error(`login falhou: ${r.status}`)
    return { Authorization: `Bearer ${sessao}` }
}

const comJson = (cab) => ({ ...cab, 'Content-Type': 'application/json' })

async function definirUrl(cab, slug, urlSaude, urlApp) {
    const r = await fetch(`${BASE}/api/console/apps/${slug}`, {
        method: 'PATCH',
        headers: comJson(cab),
        body: JSON.stringify({ urlSaude, ...(urlApp === undefined ? {} : { urlApp }) }),
    })
    if (!r.ok) throw new Error(`PATCH ${slug} devolveu ${r.status}: ${await r.text()}`)
}

const verificar = (cab) =>
    fetch(`${BASE}/api/console/saude/verificar`, { method: 'POST', headers: cab }).then((r) =>
        r.json()
    )

const status = (slug) =>
    fetch(slug === undefined ? `${BASE}/api/status` : `${BASE}/api/status/${slug}`).then((r) =>
        r.json()
    )

const doApp = (vereditos, slug) => vereditos.find((v) => v.slug === slug)

async function tokenDoApp(slug, usuario, email) {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${slug}.privada.jwk.json`, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({
        app: slug,
        tenant_id: 'tenant-aceite-saude',
        user_id: usuario,
        nome: 'Bia Contingência',
        email,
        papel: 'member',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(await importJWK(jwk, 'Ed25519'))
}

const afetado = (slug, email) =>
    fetch(`${BASE}/api/status/${slug}/afetado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    }).then(async (r) => ({ http: r.status, corpo: await r.json() }))

async function main() {
    console.log(`Aceite da saúde contra ${BASE}\n`)
    const cab = await entrar()
    ok('sessão de admin no Console')

    console.log('\n— cadastro dos endereços —')
    for (const [slug, url] of Object.entries(APPS)) await definirUrl(cab, slug, url, url)
    ok(`urlSaude dos ${Object.keys(APPS).length} apps gravada pelo Console`)

    const recusou = await fetch(`${BASE}/api/console/apps/${COBAIA}`, {
        method: 'PATCH',
        headers: comJson(cab),
        body: JSON.stringify({ urlSaude: '/saude' }),
    })
    recusou.status === 400
        ? ok('endereço relativo recusado (a sondagem sai de fora do app)')
        : nao(`endereço relativo devolveu ${recusou.status}, esperado 400`)

    console.log('\n— os três de pé —')
    let v = (await verificar(cab)).vereditos
    for (const slug of Object.keys(APPS)) {
        const d = doApp(v, slug)
        d?.saudavel === true
            ? ok(`${slug}: ${d.detalhe} em ${d.latenciaMs} ms`)
            : nao(`${slug}: ${JSON.stringify(d)}`)
    }

    const publico = await status()
    publico.apps?.length === 3 && publico.apps.every((a) => a.estado === 'operacional')
        ? ok('/api/status público: 3 apps operacionais')
        : nao(`/api/status devolveu ${JSON.stringify(publico)}`)
    publico.apps?.every((a) => !('urlSaude' in a))
        ? ok('a rota pública não expõe o endereço sondado')
        : nao('a rota pública expôs urlSaude')

    console.log(`\n— derrubando ${COBAIA} de propósito —`)
    await definirUrl(cab, COBAIA, MORTO)

    v = (await verificar(cab)).vereditos
    const primeira = doApp(v, COBAIA)
    primeira?.mudanca === null && primeira?.saudavel === true && primeira?.falhasSeguidas === 1
        ? ok('1ª falha: contada, NENHUM incidente aberto')
        : nao(`1ª falha devolveu ${JSON.stringify(primeira)}`)

    v = (await verificar(cab)).vereditos
    const segunda = doApp(v, COBAIA)
    segunda?.mudanca === 'caiu' && segunda?.saudavel === false
        ? ok('2ª falha: queda declarada')
        : nao(`2ª falha devolveu ${JSON.stringify(segunda)}`)
    segunda?.problemId
        ? ok(`problema urgente aberto (${segunda.problemId.slice(0, 8)}…)`)
        : nao('nenhum problema aberto')

    v = (await verificar(cab)).vereditos
    const terceira = doApp(v, COBAIA)
    terceira?.mudanca === null && terceira?.falhasSeguidas === 3
        ? ok('3ª falha: NÃO abre um segundo problema')
        : nao(`3ª falha devolveu ${JSON.stringify(terceira)}`)

    const dele = await status(COBAIA)
    dele.estado === 'fora_do_ar' && dele.episodios?.[0]?.terminadoEm === null
        ? ok('página de status: incidente em aberto publicado')
        : nao(`/api/status/${COBAIA} devolveu ${JSON.stringify(dele)}`)

    const inicio = dele.episodios?.[0]?.iniciadoEm
    console.log('\n— também fui afetado —')
    const desconhecido = await afetado(COBAIA, `ninguem-${Date.now()}@exemplo.invalid`)
    desconhecido.http === 200 && desconhecido.corpo.numero === undefined
        ? ok('e-mail desconhecido: mesmo recibo, nenhum chamado')
        : nao(`desconhecido devolveu ${JSON.stringify(desconhecido)}`)

    /// Vira conhecido do jeito que o app torna alguém conhecido: um token.
    const email = `bia-${Date.now()}@exemplo.com.br`
    const t = await tokenDoApp(COBAIA, `saude-${Date.now()}`, email)
    const eu = await fetch(`${BASE}/api/app/${COBAIA}/eu`, {
        headers: { Authorization: `Bearer ${t}` },
    })
    eu.ok ? ok('solicitante conhecido criado pelo token do app') : nao(`/eu devolveu ${eu.status}`)

    const conhecido = await afetado(COBAIA, email)
    conhecido.corpo.numero
        ? ok(`e-mail conhecido: chamado ${conhecido.corpo.numero} ligado ao incidente`)
        : nao(`conhecido devolveu ${JSON.stringify(conhecido)}`)

    const repetido = await afetado(COBAIA, email)
    repetido.corpo.numero === undefined
        ? ok('o segundo clique não abre um segundo chamado')
        : nao(`repetido abriu ${repetido.corpo.numero}`)

    console.log('\n— a volta —')
    await definirUrl(cab, COBAIA, APPS[COBAIA])
    v = (await verificar(cab)).vereditos
    const volta = doApp(v, COBAIA)
    volta?.mudanca === 'voltou' && volta?.saudavel === true
        ? ok('queda encerrada na primeira resposta boa')
        : nao(`volta devolveu ${JSON.stringify(volta)}`)

    const depois = await status(COBAIA)
    const fechado = depois.episodios?.find((e) => e.iniciadoEm === inicio)
    fechado?.terminadoEm
        ? ok('episódio fechado, com início e fim no histórico')
        : nao(`episódio não fechou: ${JSON.stringify(depois.episodios?.[0])}`)
    depois.estado === 'operacional'
        ? ok('página de status: operacional de novo')
        : nao(`estado final ${depois.estado}`)

    console.log(
        falhas === 0 ? '\n✓ Aceite da saúde aprovado.' : `\n✗ ${falhas} falha(s) no aceite.`
    )
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((erro) => {
    console.error('\n✗ aceite interrompido:', erro.message)
    process.exit(1)
})
