/**
 * Aceite da Fase 3. Hoje cobre o tempo real: a sala (Durable Object) empurra
 * para quem está olhando o chamado.
 *
 * Uso: BASE=https://… node scripts/aceite-fase-3.mjs
 */
import { readFileSync } from 'node:fs'

import { importJWK, SignJWT } from 'jose'

const BASE = process.env.BASE ?? 'http://localhost:8787'
let falhas = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const nao = (t) => {
    falhas += 1
    console.log(`  ✗ ${t}`)
}

async function token(slug, usuario) {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${slug}.privada.jwk.json`, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({
        app: slug,
        tenant_id: 'tenant-tempo-real',
        user_id: usuario,
        nome: 'Ana Tempo Real',
        email: 'ana@exemplo.com.br',
        papel: 'member',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(await importJWK(jwk, 'Ed25519'))
}

async function main() {
    console.log(`Aceite da Fase 3 contra ${BASE}\n— tempo real —`)
    const t = await token('odontobox', `tr-${Date.now()}`)
    const cab = { Authorization: `Bearer ${t}` }

    const criado = await fetch(`${BASE}/api/app/odontobox/chamados`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assunto: 'Aceite do tempo real',
            descricao: 'Chamado do aceite automatico da Fase 3.',
            impacto: 'so_eu',
        }),
    }).then((r) => r.json())

    const numero = criado.chamado?.numero?.split('-')[1]?.replace(/^0+/, '')
    numero ? ok(`chamado ${criado.chamado.numero}`) : nao('nao criou chamado')
    if (!numero) return

    const ctrl = new AbortController()
    const eventos = []
    const fluxo = fetch(`${BASE}/api/app/odontobox/chamados/${numero}/eventos`, {
        headers: cab,
        signal: ctrl.signal,
    })
        .then(async (r) => {
            if (r.headers.get('content-type')?.includes('text/event-stream')) {
                ok('fluxo aberto como text/event-stream')
            } else {
                nao(`fluxo devolveu ${r.status} ${r.headers.get('content-type')}`)
                return
            }
            const leitor = r.body.getReader()
            const dec = new TextDecoder()
            while (true) {
                const { done, value } = await leitor.read()
                if (done) break
                for (const linha of dec.decode(value).split('\n')) {
                    if (linha.startsWith('event:')) eventos.push(linha.trim())
                }
            }
        })
        .catch(() => {})

    await new Promise((r) => setTimeout(r, 2500))

    /// A segunda mensagem do proprio autor, com o chamado ainda em NOVO: foi a
    /// combinacao que a maquina de estados recusava ate 17/11/2026.
    const resposta = await fetch(`${BASE}/api/app/odontobox/chamados/${numero}/mensagens`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Esqueci de dizer: so acontece no Chrome.' }),
    })
    resposta.status === 201
        ? ok('segunda mensagem do autor aceita com o chamado em NOVO')
        : nao(`segunda mensagem devolveu ${resposta.status}`)

    await new Promise((r) => setTimeout(r, 3000))
    ctrl.abort()
    await fluxo

    eventos.some((e) => e.startsWith('event: mensagem'))
        ? ok('o empurrao chegou pela sala')
        : nao(`nenhum evento chegou (recebidos: ${JSON.stringify(eventos)})`)

    console.log(falhas === 0 ? '\n✓ Aceite parcial da Fase 3 aprovado.' : `\n✗ ${falhas} reprovaram.`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
    console.error('ABORTA:', e.message)
    process.exit(1)
})
