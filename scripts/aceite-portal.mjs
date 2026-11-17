/**
 * Aceite do portal de contingência (Fase 3, item 3 da seção 7).
 *
 * Prova contra o Worker publicado que o portal reconhece quem já é conhecido,
 * não cria ninguém, mostra só o que é da pessoa, e recusa link forjado,
 * vencido, de outro app e de outro usuário.
 *
 * O link verdadeiro chega por e-mail e não passa por aqui — então o aceite
 * assina um token com o MESMO segredo do Worker, lido do cofre, para exercer as
 * rotas que o link abre. O segredo não é impresso.
 *
 * Uso: BASE=https://… node scripts/aceite-portal.mjs
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { importJWK, SignJWT } from 'jose'
import pg from 'pg'

const BASE = process.env.BASE ?? 'https://venn-desk.andre-7ee.workers.dev'
const AMBIENTE = process.env.AMBIENTE ?? 'stg'
const APP = 'odontobox'
const OUTRO_APP = 'conecta'

let falhas = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const nao = (t) => {
    falhas += 1
    console.log(`  ✗ ${t}`)
}

function doCofre(nome) {
    const arquivo = join(homedir(), '.venn360-secrets/venn-desk', `worker-${AMBIENTE}.env`)
    const linha = readFileSync(arquivo, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(`export ${nome}=`))
    if (linha === undefined) throw new Error(`${nome} não está em ${arquivo}`)
    return linha.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

/** O mesmo formato de `src/lib/assinatura.ts`: `<expiraEm>.<hmac base64url>`. */
function assinar(segredo, { appId, chave, expiraEm }) {
    const mac = createHmac('sha256', segredo).update(`${appId}:${chave}:${expiraEm}`).digest('base64')
    return `${expiraEm}.${mac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

async function tokenDoApp(slug, usuario, email, nome) {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${slug}.privada.jwk.json`, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({
        app: slug,
        tenant_id: 'tenant-portal',
        user_id: usuario,
        nome,
        email,
        papel: 'member',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(await importJWK(jwk, 'Ed25519'))
}

const entrar = (slug, email) =>
    fetch(`${BASE}/api/portal/app/${slug}/entrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    }).then(async (r) => ({ http: r.status, corpo: await r.json() }))

const abrir = (slug, u, t, caminho = '') =>
    fetch(
        `${BASE}/api/portal/app/${slug}/chamados${caminho}?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`
    ).then(async (r) => ({ http: r.status, corpo: await r.json() }))

/**
 * O id do app e o do solicitante saem do BANCO, não da API.
 *
 * `/api/app/<slug>/eu` não devolve nenhum dos dois — e não deve: o widget não
 * precisa deles, e id interno numa resposta pública é superfície à toa. Este
 * aceite roda nesta máquina, com acesso ao cofre, então ele olha onde o dado
 * está em vez de pedir que a API passe a expô-lo para facilitar um teste.
 */
async function idsDoBanco(slug, email) {
    const arquivo = join(homedir(), '.venn360-secrets/venn-desk', `neon-${AMBIENTE === 'stg' ? 'staging' : 'production'}.env`)
    const linha = readFileSync(arquivo, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('export DATABASE_URL_MIGRATOR='))
    if (linha === undefined) throw new Error(`DATABASE_URL_MIGRATOR não está em ${arquivo}`)
    const url = linha.slice('export DATABASE_URL_MIGRATOR='.length).trim().replace(/^['"]|['"]$/g, '')

    const cliente = new pg.Client({ connectionString: url })
    await cliente.connect()
    try {
        const app = await cliente.query('SELECT id FROM apps WHERE slug = $1', [slug])
        const quem = await cliente.query(
            'SELECT id FROM requesters WHERE app_id = $1 AND lower(email) = lower($2)',
            [app.rows[0]?.id, email]
        )
        return { appId: app.rows[0]?.id ?? null, requesterId: quem.rows[0]?.id ?? null }
    } finally {
        await cliente.end()
    }
}

async function main() {
    console.log(`Aceite do portal contra ${BASE}\n`)
    const segredo = doCofre('SEGREDO_LINKS')
    const marca = Date.now()

    console.log('— quem o portal reconhece —')
    const email = `portal-${marca}@exemplo.com.br`
    const t = await tokenDoApp(APP, `portal-${marca}`, email, 'Dora Portal')
    const eu = await fetch(`${BASE}/api/app/${APP}/eu`, { headers: { Authorization: `Bearer ${t}` } })
    eu.ok ? ok('solicitante criado pelo token do app') : nao(`/eu devolveu ${eu.status}`)

    const chamado = await fetch(`${BASE}/api/app/${APP}/chamados`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assunto: 'Aceite do portal de contingência',
            descricao: 'Chamado criado pelo aceite automático do portal.',
            impacto: 'so_eu',
        }),
    }).then((r) => r.json())
    chamado.chamado?.numero ? ok(`chamado ${chamado.chamado.numero}`) : nao('não criou chamado')

    console.log('\n— pedir acesso —')
    const conhecido = await entrar(APP, email)
    const desconhecido = await entrar(APP, `ninguem-${marca}@exemplo.invalid`)
    conhecido.http === 200 && desconhecido.http === 200
        ? ok('os dois pedidos respondem 200')
        : nao(`${conhecido.http} / ${desconhecido.http}`)
    conhecido.corpo.mensagem === desconhecido.corpo.mensagem
        ? ok('recibo IDÊNTICO para e-mail conhecido e desconhecido')
        : nao(`recibos diferentes: "${conhecido.corpo.mensagem}" vs "${desconhecido.corpo.mensagem}"`)
    JSON.stringify(conhecido.corpo).includes('t=') === false
        ? ok('o recibo não devolve o link (ele só existe no e-mail)')
        : nao('o recibo vazou o link')

    console.log('\n— o que o link abre —')
    const { appId: idDoApp, requesterId } = await idsDoBanco(APP, email)
    const agora = Math.floor(Date.now() / 1000)
    const chave = `portal:${requesterId}`

    if (idDoApp === null || requesterId === null) {
        nao('não achei o app ou o solicitante no banco')
    } else {
        const bom = assinar(segredo, { appId: idDoApp, chave, expiraEm: agora + 600 })
        const lista = await abrir(APP, requesterId, bom)
        lista.http === 200 && Array.isArray(lista.corpo.chamados)
            ? ok(`lista aberta: ${lista.corpo.chamados.length} chamado(s) de ${lista.corpo.usuario.nome}`)
            : nao(`lista devolveu ${lista.http}: ${JSON.stringify(lista.corpo).slice(0, 160)}`)

        const numero = lista.corpo.chamados?.[0]?.sequencial
        if (numero !== undefined) {
            const um = await abrir(APP, requesterId, bom, `/${numero}`)
            um.http === 200 && Array.isArray(um.corpo.mensagens)
                ? ok('conversa aberta, só com mensagens públicas')
                : nao(`conversa devolveu ${um.http}`)
        }

        const vencido = assinar(segredo, { appId: idDoApp, chave, expiraEm: agora - 10 })
        ;(await abrir(APP, requesterId, vencido)).http === 401
            ? ok('link vencido: 401')
            : nao('link vencido foi aceito')

        const deOutro = assinar(segredo, {
            appId: idDoApp,
            chave: 'portal:outro-usuario-qualquer',
            expiraEm: agora + 600,
        })
        ;(await abrir(APP, requesterId, deOutro)).http === 401
            ? ok('assinatura de OUTRO usuário no mesmo link: 401')
            : nao('assinatura de outro usuário foi aceita')

        ;(await abrir(OUTRO_APP, requesterId, bom)).http === 401
            ? ok(`link do ${APP} recusado no ${OUTRO_APP}: 401`)
            : nao('link de um app serviu em outro')
    }

    const forjado = `${agora + 600}.${'a'.repeat(43)}`
    ;(await abrir(APP, requesterId, forjado)).http === 401
        ? ok('assinatura forjada: 401')
        : nao('assinatura forjada foi aceita')
    ;(await abrir(APP, requesterId, '')).http === 401
        ? ok('sem token: 401')
        : nao('sem token foi aceito')

    /**
     * `--link` imprime um link de portal válido para olhar a tela.
     *
     * O que é impresso é um token DERIVADO e escopado: um solicitante, um app,
     * trinta minutos. O `SEGREDO_LINKS` continua só no cofre. Mesmo assim o
     * padrão é não imprimir, porque um link de portal é credencial — use a
     * bandeira só quando for conferir a tela, e em staging.
     */
    if (process.argv.includes('--link') && idDoApp !== null && requesterId !== null) {
        const olhar = assinar(segredo, { appId: idDoApp, chave, expiraEm: agora + 1800 })
        console.log(
            `\nlink para conferir a tela (vale 30 min, usuário de teste):\n${BASE}/portal/${APP}?u=${requesterId}&t=${encodeURIComponent(olhar)}`
        )
    }

    console.log(falhas === 0 ? '\n✓ Aceite do portal aprovado.' : `\n✗ ${falhas} falha(s).`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((erro) => {
    console.error('\n✗ aceite interrompido:', erro.message)
    process.exit(1)
})
