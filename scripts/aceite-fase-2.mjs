/**
 * Aceite da Fase 2, contra o Worker publicado. Cresce conforme o widget avança.
 *
 * Hoje cobre o que o widget precisa da API: identidade com contadores do selo,
 * e anexo indo para o R2 com link assinado de volta.
 *
 * Uso: BASE=https://… node scripts/aceite-fase-2.mjs
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

async function token(slug, usuario = 'usuario-teste') {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${slug}.privada.jwk.json`, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({
        app: slug,
        tenant_id: 'tenant-teste',
        user_id: usuario,
        nome: 'Ana de Teste',
        email: 'ana@clinicateste.com.br',
        papel: 'member',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(await importJWK(jwk, 'Ed25519'))
}

async function main() {
    console.log(`Aceite da Fase 2 contra ${BASE}\n`)
    const t = await token('odontobox')
    const cab = { Authorization: `Bearer ${t}` }

    console.log('— identidade e selo —')
    const eu = await fetch(`${BASE}/api/app/odontobox/eu`, { headers: cab }).then((r) => r.json())
    eu.usuario?.nome === 'Ana de Teste' ? ok(`usuario: ${eu.usuario.nome}`) : nao('nome do usuario nao voltou')
    eu.app?.prefixo === 'ODB' ? ok(`app: ${eu.app.nome} (${eu.app.prefixo})`) : nao('app nao voltou')
    typeof eu.contadores?.abertos === 'number'
        ? ok(`contadores: ${eu.contadores.abertos} abertos, ${eu.contadores.emAndamento} em andamento, ${eu.contadores.naoLidas} nao lidas`)
        : nao('contadores nao voltaram')

    console.log('\n— anexo —')
    const criado = await fetch(`${BASE}/api/app/odontobox/chamados`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assunto: 'Teste de anexo pelo aceite da Fase 2',
            descricao: 'Chamado criado para exercitar o envio de arquivo.',
            impacto: 'so_eu',
        }),
    }).then((r) => r.json())
    const numero = criado.chamado?.numero?.split('-')[1]?.replace(/^0+/, '')
    numero ? ok(`chamado ${criado.chamado.numero}`) : nao('nao criou chamado para o anexo')
    if (!numero) return

    /// PNG de 1x1 real, para o tipo conferir de verdade.
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+AaQAAAAASUVORK5CYII=',
        'base64'
    )

    const forma = new FormData()
    forma.append('arquivo', new Blob([png], { type: 'image/png' }), 'captura.png')
    const envio = await fetch(`${BASE}/api/app/odontobox/chamados/${numero}/anexos`, {
        method: 'POST',
        headers: cab,
        body: forma,
    })
    const enviado = await envio.json()
    envio.status === 201 ? ok(`anexo aceito: ${enviado.anexo?.nome} (${enviado.anexo?.tamanho}B)`) : nao(`anexo devolveu ${envio.status}: ${JSON.stringify(enviado).slice(0, 120)}`)

    const executavel = new FormData()
    executavel.append('arquivo', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe')
    const recusa = await fetch(`${BASE}/api/app/odontobox/chamados/${numero}/anexos`, {
        method: 'POST',
        headers: cab,
        body: executavel,
    })
    recusa.status === 415 ? ok('executavel recusado (415)') : nao(`executavel devolveu ${recusa.status}`)

    const visto = await fetch(`${BASE}/api/app/odontobox/chamados/${numero}`, { headers: cab }).then((r) => r.json())
    visto.anexos?.length === 1 ? ok('o anexo aparece no chamado') : nao(`chamado lista ${visto.anexos?.length} anexo(s)`)

    const id = visto.anexos?.[0]?.id
    if (id) {
        const link = await fetch(
            `${BASE}/api/app/odontobox/chamados/${numero}/anexos/${encodeURIComponent(id)}`,
            { headers: cab }
        ).then((r) => r.json())
        link.url?.includes('?t=') ? ok('link assinado emitido') : nao('link sem assinatura')

        const baixado = await fetch(`${BASE}${link.url}`)
        baixado.status === 200 && Number(baixado.headers.get('content-length')) === png.length
            ? ok('o arquivo baixa pelo link assinado, com o tamanho certo')
            : nao(`download devolveu ${baixado.status}`)

        const semAssinatura = await fetch(`${BASE}/arquivos/${encodeURIComponent(id)}`)
        semAssinatura.status === 404 ? ok('sem assinatura: 404') : nao(`sem assinatura devolveu ${semAssinatura.status}`)
    }

    console.log(falhas === 0 ? '\n✓ Aceite parcial da Fase 2 aprovado.' : `\n✗ ${falhas} reprovaram.`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
    console.error('ABORTA:', e.message)
    process.exit(1)
})
