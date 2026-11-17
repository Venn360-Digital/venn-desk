/**
 * O aceite da Fase 1, contra o Worker publicado.
 *
 * O critério da especificação, literal: "com um token de teste, criar,
 * responder, resolver e reabrir um chamado via API. Um token do app A não lê
 * nada do app B."
 *
 * Uso:
 *   BASE=https://venn-desk.andre-7ee.workers.dev \
 *   CONSOLE_SENHA_INICIAL=... node scripts/aceite-fase-1.mjs
 *
 * As chaves privadas de teste saem de .dev/chaves, escritas pela semente.
 * Nenhum segredo é impresso.
 */
import { readFileSync } from 'node:fs'

import { importJWK, SignJWT } from 'jose'

const BASE = process.env.BASE ?? 'http://localhost:8787'
const SENHA = process.env.CONSOLE_SENHA_INICIAL

let falhas = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const nao = (t) => {
    falhas += 1
    console.log(`  ✗ ${t}`)
}

async function tokenDe(slug, { usuario = 'usuario-teste', tenant = 'tenant-teste', papel = 'member' } = {}) {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${slug}.privada.jwk.json`, 'utf8'))
    const chave = await importJWK(jwk, 'Ed25519')
    const agora = Math.floor(Date.now() / 1000)

    return new SignJWT({
        app: slug,
        tenant_id: tenant,
        user_id: usuario,
        nome: 'Ana de Teste',
        email: 'ana@clinicateste.com.br',
        papel,
        plano: 'pro',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(chave)
}

async function api(caminho, { metodo = 'GET', token, corpo, cookie } = {}) {
    const r = await fetch(`${BASE}${caminho}`, {
        method: metodo,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    })
    const texto = await r.text()
    let json = null
    try {
        json = JSON.parse(texto)
    } catch {
        json = { bruto: texto.slice(0, 200) }
    }
    return { status: r.status, json, cookies: r.headers.getSetCookie?.() ?? [] }
}

async function main() {
    console.log(`Aceite da Fase 1 contra ${BASE}\n`)

    const odb = await tokenDe('odontobox')

    console.log('— solicitante: abrir —')
    const criado = await api('/api/app/odontobox/chamados', {
        metodo: 'POST',
        token: odb,
        corpo: {
            assunto: 'A agenda nao abre depois do login',
            descricao: 'Entro na conta e a agenda fica girando. Ja limpei o cache.',
            impacto: 'minha_equipe',
            contexto: { rota: '/agenda', navegador: 'Safari 17' },
        },
    })
    if (criado.status === 201 && criado.json.chamado?.numero?.startsWith('ODB-')) {
        ok(`chamado criado: ${criado.json.chamado.numero} (grupo ${criado.json.chamado.grupo})`)
    } else {
        nao(`criar chamado devolveu ${criado.status}: ${JSON.stringify(criado.json).slice(0, 160)}`)
        return
    }
    const numero = criado.json.chamado.numero.split('-')[1].replace(/^0+/, '')

    console.log('\n— isolamento entre apps —')
    const cruzado = await api(`/api/app/conecta/chamados`, { token: odb })
    if (cruzado.status === 401 || cruzado.status === 404) {
        ok(`token do odontobox recusado no conecta (HTTP ${cruzado.status})`)
    } else {
        nao(`token do odontobox foi ACEITO no conecta: HTTP ${cruzado.status}`)
    }

    const semToken = await api('/api/app/odontobox/chamados')
    semToken.status === 401 ? ok('sem token: 401') : nao(`sem token devolveu ${semToken.status}`)

    console.log('\n— solicitante: ler —')
    const lista = await api('/api/app/odontobox/chamados?grupo=abertos', { token: odb })
    lista.status === 200 && lista.json.chamados?.length >= 1
        ? ok(`lista "abertos" traz ${lista.json.chamados.length}`)
        : nao(`lista devolveu ${lista.status}`)

    const outro = await tokenDe('odontobox', { usuario: 'outro-usuario' })
    const listaDoOutro = await api('/api/app/odontobox/chamados', { token: outro })
    listaDoOutro.json.chamados?.length === 0
        ? ok('outro usuario do mesmo app nao ve o chamado alheio')
        : nao(`outro usuario viu ${listaDoOutro.json.chamados?.length} chamado(s)`)

    console.log('\n— agente: entrar no Console —')
    if (!SENHA) {
        nao('CONSOLE_SENHA_INICIAL ausente: pulando a parte interna')
        return
    }
    const entrada = await api('/api/console/sessao', {
        metodo: 'POST',
        corpo: { email: 'admin@venn360.com', senha: SENHA },
    })
    const cookie = entrada.cookies.map((c) => c.split(';')[0]).join('; ')
    entrada.status === 200 ? ok(`sessao aberta como ${entrada.json.agente?.nome}`) : nao(`login devolveu ${entrada.status}`)
    if (!cookie) return nao('sem cookie de sessao')

    const fila = await api('/api/console/app/odontobox/fila', { cookie })
    fila.status === 200 && fila.json.chamados?.length >= 1
        ? ok(`fila do odontobox: ${fila.json.chamados.length}`)
        : nao(`fila devolveu ${fila.status}`)

    console.log('\n— agente: responder e resolver —')
    const resposta = await api(`/api/console/app/odontobox/chamados/${numero}/mensagens`, {
        metodo: 'POST',
        cookie,
        corpo: { corpo: 'Oi Ana, era cache do navegador. Pode testar agora?', visibilidade: 'PUBLICA' },
    })
    resposta.status === 201 && resposta.json.status === 'AGUARDANDO_USUARIO'
        ? ok('resposta publica enviada, chamado em AGUARDANDO_USUARIO')
        : nao(`responder devolveu ${resposta.status} / ${resposta.json.status}`)

    const nota = await api(`/api/console/app/odontobox/chamados/${numero}/mensagens`, {
        metodo: 'POST',
        cookie,
        corpo: { corpo: 'Nota interna: conferir se e o bug do service worker.', visibilidade: 'INTERNA' },
    })
    nota.status === 201 ? ok('nota interna gravada') : nao(`nota devolveu ${nota.status}`)

    const visto = await api(`/api/app/odontobox/chamados/${numero}`, { token: odb })
    const corpos = (visto.json.mensagens ?? []).map((m) => m.corpo)
    corpos.some((c) => c.includes('cache do navegador')) && !corpos.some((c) => c.includes('Nota interna'))
        ? ok('o solicitante ve a resposta publica e NAO ve a nota interna')
        : nao('vazou nota interna para o solicitante, ou a publica nao chegou')

    const resolvido = await api(`/api/console/app/odontobox/chamados/${numero}/eventos`, {
        metodo: 'POST',
        cookie,
        corpo: { evento: 'resolver' },
    })
    resolvido.json.status === 'RESOLVIDO' ? ok('resolvido') : nao(`resolver devolveu ${resolvido.json.status}`)

    console.log('\n— solicitante: reabrir —')
    const reaberto = await api(`/api/app/odontobox/chamados/${numero}/mensagens`, {
        metodo: 'POST',
        token: odb,
        corpo: { corpo: 'Voltou a travar hoje de manha.' },
    })
    reaberto.json.chamado?.status === 'ABERTO'
        ? ok('resposta do usuario reabriu o chamado (RESOLVIDO -> ABERTO)')
        : nao(`reabrir devolveu ${JSON.stringify(reaberto.json).slice(0, 160)}`)

    console.log(falhas === 0 ? '\n✓ Fase 1 aceita.' : `\n✗ ${falhas} verificacao(oes) reprovaram.`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
    console.error('ABORTA:', e.message)
    process.exit(1)
})
