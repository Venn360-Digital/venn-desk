/**
 * Aceite dos prazos de SLA e do cão de guarda (seções 4 e 5).
 *
 * Prova contra o Worker publicado que o relógio nasce com o chamado, pausa
 * quando a bola passa ao usuário, retoma sem perder o tempo parado, é cumprido
 * pela resposta pública, e — quando ninguém responde — vira violação registrada
 * com o cão de guarda.
 *
 * **O tempo é envelhecido no BANCO, não na API.** Seria cômodo a rota aceitar
 * um `agora` e o aceite fabricar o futuro; seria também uma requisição capaz de
 * marcar a fila inteira como violada. Este script já tem a credencial do
 * migrador no cofre, então ele empurra o `vence_em` para trás e deixa a rota
 * olhar o relógio de verdade.
 *
 * Uso: BASE=https://… node scripts/aceite-sla.mjs
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { importJWK, SignJWT } from 'jose'
import pg from 'pg'

const BASE = process.env.BASE ?? 'https://venn-desk.andre-7ee.workers.dev'
const AMBIENTE = process.env.AMBIENTE ?? 'stg'
const APP = 'odontobox'

let falhas = 0
const ok = (t) => console.log(`  ✓ ${t}`)
const nao = (t) => {
    falhas += 1
    console.log(`  ✗ ${t}`)
}

function doCofre(arquivo, nome) {
    const caminho = join(homedir(), '.venn360-secrets/venn-desk', arquivo)
    const linha = readFileSync(caminho, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(`export ${nome}=`))
    if (linha === undefined) throw new Error(`${nome} não está em ${caminho}`)
    return linha.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

const banco = () =>
    new pg.Client({
        connectionString: doCofre(
            `neon-${AMBIENTE === 'stg' ? 'staging' : 'production'}.env`,
            'DATABASE_URL_MIGRATOR'
        ),
    })

async function noBanco(acao) {
    const cliente = banco()
    await cliente.connect()
    try {
        return await acao(cliente)
    } finally {
        await cliente.end()
    }
}

async function entrar() {
    const r = await fetch(`${BASE}/api/console/sessao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'admin@venn360.com',
            senha: doCofre(`worker-${AMBIENTE}.env`, 'CONSOLE_SENHA_INICIAL'),
        }),
    })
    const sessao = /venn_desk_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]
    if (!r.ok || sessao === undefined) throw new Error(`login falhou: ${r.status}`)
    return { Authorization: `Bearer ${sessao}` }
}

async function tokenDoApp(usuario, email) {
    const jwk = JSON.parse(readFileSync(`.dev/chaves/${APP}.privada.jwk.json`, 'utf8'))
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({
        app: APP,
        tenant_id: 'tenant-sla',
        user_id: usuario,
        nome: 'Caio Prazo',
        email,
        papel: 'member',
    })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience('venn-desk')
        .setIssuedAt(agora)
        .setExpirationTime(agora + 300)
        .sign(await importJWK(jwk, 'Ed25519'))
}

const relogios = (ticketId) =>
    noBanco(async (c) => {
        const r = await c.query(
            'SELECT id, meta, meta_min, vence_em, pausado_em, violado_em, cumprido_em FROM sla_timers WHERE ticket_id = $1 ORDER BY meta',
            [ticketId]
        )
        return r.rows
    })

const envelhecer = (ticketId, meta, minutos) =>
    noBanco((c) =>
        c.query(
            `UPDATE sla_timers SET vence_em = vence_em - make_interval(mins => $3)
             WHERE ticket_id = $1 AND meta = $2`,
            [ticketId, meta, minutos]
        )
    )

const eventos = (ticketId) =>
    noBanco(async (c) => {
        const r = await c.query(
            'SELECT evento FROM ticket_events WHERE ticket_id = $1 ORDER BY criado_em',
            [ticketId]
        )
        return r.rows.map((x) => x.evento)
    })

const varrer = (cab) =>
    fetch(`${BASE}/api/console/sla/vigiar`, { method: 'POST', headers: cab }).then((r) => r.json())

async function abrirChamado(prioridadeDesejada) {
    const marca = Date.now()
    const t = await tokenDoApp(`sla-${marca}`, `caio-${marca}@exemplo.invalid`)
    const criado = await fetch(`${BASE}/api/app/${APP}/chamados`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assunto: `Aceite de SLA ${marca}`,
            descricao: 'Chamado do aceite automático dos prazos.',
            impacto: prioridadeDesejada,
        }),
    }).then((r) => r.json())

    const numero = Number(criado.chamado?.numero?.split('-')[1])
    const id = await noBanco(async (c) => {
        const r = await c.query(
            'SELECT t.id FROM tickets t JOIN apps a ON a.id = t.app_id WHERE a.slug = $1 AND t.numero = $2',
            [APP, numero]
        )
        return r.rows[0]?.id ?? null
    })

    return { numero, id, token: t, rotulo: criado.chamado?.numero }
}

async function main() {
    console.log(`Aceite dos prazos contra ${BASE}\n`)
    const cab = await entrar()
    ok('sessão de admin no Console')

    console.log('\n— o relógio nasce com o chamado —')
    const a = await abrirChamado('nao_consigo_trabalhar')
    a.id ? ok(`chamado ${a.rotulo}`) : nao('não achei o chamado no banco')
    if (!a.id) process.exit(1)

    const nascidos = await relogios(a.id)
    nascidos.length === 2
        ? ok(`dois relógios: ${nascidos.map((r) => r.meta).join(', ')}`)
        : nao(`nasceram ${nascidos.length} relógios: ${JSON.stringify(nascidos)}`)
    nascidos.every((r) => r.meta_min > 0 && r.vence_em > new Date())
        ? ok('ambos com meta em minutos e vencimento no futuro')
        : nao(`metas ou vencimentos errados: ${JSON.stringify(nascidos)}`)
    nascidos.some((r) => r.meta === 'proxima_resposta')
        ? nao('proxima_resposta não deve nascer na abertura')
        : ok('proxima_resposta NÃO nasce na abertura (não há próxima a dar)')

    console.log('\n— a resposta pública cumpre a primeira resposta —')
    const b = await abrirChamado('so_eu')
    await fetch(`${BASE}/api/console/app/${APP}/chamados/${b.numero}/mensagens`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Oi, já estou vendo.', visibilidade: 'PUBLICA' }),
    })
    const depoisDaResposta = await relogios(b.id)
    const primeiraB = depoisDaResposta.find((r) => r.meta === 'primeira_resposta')
    primeiraB?.cumprido_em
        ? ok('primeira_resposta cumprida pela mensagem pública')
        : nao(`primeira_resposta não foi cumprida: ${JSON.stringify(primeiraB)}`)

    console.log('\n— a nota interna não cumpre —')
    const c = await abrirChamado('so_eu')
    await fetch(`${BASE}/api/console/app/${APP}/chamados/${c.numero}/mensagens`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'anotando aqui', visibilidade: 'INTERNA' }),
    })
    const comNota = (await relogios(c.id)).find((r) => r.meta === 'primeira_resposta')
    comNota?.cumprido_em === null
        ? ok('nota interna NÃO cumpre o prazo (é conversa entre nós)')
        : nao('nota interna cumpriu o prazo')

    console.log('\n— a pausa e a retomada —')
    /**
     * O que leva a AGUARDANDO_USUARIO é a MENSAGEM pública, não um botão de
     * status: `responder_usuario` não está no enum da rota de eventos do
     * Console, de propósito — o atendente passa a bola respondendo, não
     * marcando. Medido em 17/11/2026, quando este aceite tentou o botão e
     * levou 400.
     */
    const antesDaPausa = (await relogios(c.id)).find((r) => r.meta === 'resolucao')
    const passouABola = await fetch(
        `${BASE}/api/console/app/${APP}/chamados/${c.numero}/mensagens`,
        {
            method: 'POST',
            headers: { ...cab, 'Content-Type': 'application/json' },
            body: JSON.stringify({ corpo: 'Pode conferir e me dizer?', visibilidade: 'PUBLICA' }),
        }
    )
    passouABola.ok ? ok('resposta pública enviada') : nao(`resposta devolveu ${passouABola.status}`)
    const pausado = (await relogios(c.id)).find((r) => r.meta === 'resolucao')
    pausado?.pausado_em
        ? ok('aguardando usuário: relógio da resolução pausado')
        : nao(`não pausou: ${JSON.stringify(pausado)}`)
    String(pausado?.vence_em) === String(antesDaPausa?.vence_em)
        ? ok('a pausa NÃO mexeu no vencimento (só a retomada empurra)')
        : nao('a pausa mexeu no vencimento')

    /// Envelhece a pausa em 90 minutos e retoma: o vencimento tem de andar 90.
    await noBanco((cli) =>
        cli.query(
            "UPDATE sla_timers SET pausado_em = pausado_em - make_interval(mins => 90) WHERE ticket_id = $1 AND meta = 'resolucao'",
            [c.id]
        )
    )
    await fetch(`${BASE}/api/app/${APP}/chamados/${c.numero}/mensagens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'ainda não resolveu' }),
    })
    const retomado = (await relogios(c.id)).find((r) => r.meta === 'resolucao')
    const andou = Math.round(
        (new Date(retomado?.vence_em) - new Date(antesDaPausa?.vence_em)) / 60_000
    )
    retomado?.pausado_em === null
        ? ok('a resposta do usuário retomou o relógio')
        : nao('o relógio continuou pausado')
    andou >= 89 && andou <= 91
        ? ok(`o vencimento andou ${andou} min — exatamente o tempo parado`)
        : nao(`o vencimento andou ${andou} min, esperado ~90`)

    console.log('\n— o estouro e o cão de guarda —')
    const d = await abrirChamado('nao_consigo_trabalhar')
    await envelhecer(d.id, 'primeira_resposta', 999)
    const estouros = await varrer(cab)
    const meu = estouros.estouros?.find((e) => e.ticketId === d.id)
    meu?.meta === 'primeira_resposta' && meu?.caoDeGuarda === true
        ? ok('primeira resposta vencida: violação + cão de guarda')
        : nao(`varredura devolveu ${JSON.stringify(estouros).slice(0, 200)}`)

    const trilha = await eventos(d.id)
    trilha.includes('sla:violado:primeira_resposta')
        ? ok('evento sla:violado:primeira_resposta na trilha')
        : nao(`trilha sem o evento: ${trilha.join(', ')}`)
    trilha.includes('sla:cao_de_guarda')
        ? ok('evento sla:cao_de_guarda na trilha')
        : nao('trilha sem o cão de guarda')

    const denovo = await varrer(cab)
    denovo.estouros?.some((e) => e.ticketId === d.id)
        ? nao('a segunda varredura violou o mesmo relógio outra vez')
        : ok('a segunda varredura NÃO repete o mesmo estouro')

    console.log('\n— a resolução vencida não acorda o cão —')
    const e = await abrirChamado('so_eu')
    await envelhecer(e.id, 'resolucao', 9999)
    const soResolucao = await varrer(cab)
    const dele = soResolucao.estouros?.find((x) => x.ticketId === e.id)
    dele?.meta === 'resolucao' && dele?.caoDeGuarda === false
        ? ok('resolução vencida: violação sem cão de guarda')
        : nao(`esperado violação sem cão: ${JSON.stringify(dele)}`)

    console.log('\n— a próxima resposta —')
    /**
     * O relógio que faltava. Um chamado já respondido ficava SEM prazo
     * nenhum correndo quando o cliente voltava a falar — a fila mostrava
     * "cumprido" num chamado aberto, que se lê como "nada a fazer".
     */
    const f = await abrirChamado('so_eu')
    const semProxima = (await relogios(f.id)).some((r) => r.meta === 'proxima_resposta')
    semProxima ? nao('proxima_resposta nasceu cedo demais') : ok('na abertura NÃO existe próxima resposta')

    await fetch(`${BASE}/api/console/app/${APP}/chamados/${f.numero}/mensagens`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Oi, pode detalhar?', visibilidade: 'PUBLICA' }),
    })
    await fetch(`${BASE}/api/app/${APP}/chamados/${f.numero}/mensagens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Detalhando: acontece toda manhã.' }),
    })
    const comProxima = (await relogios(f.id)).find((r) => r.meta === 'proxima_resposta')
    comProxima && comProxima.cumprido_em === null
        ? ok('o cliente voltou a falar: próxima resposta correndo')
        : nao(`sem relógio de próxima resposta: ${JSON.stringify(comProxima)}`)

    await fetch(`${BASE}/api/console/app/${APP}/chamados/${f.numero}/mensagens`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Obrigado, vou verificar.', visibilidade: 'PUBLICA' }),
    })
    const cumprida = (await relogios(f.id)).find((r) => r.meta === 'proxima_resposta')
    cumprida?.cumprido_em
        ? ok('respondemos de novo: próxima resposta cumprida')
        : nao('a próxima resposta não foi cumprida')

    console.log('\n— reabrir ganha relógio novo —')
    await fetch(`${BASE}/api/console/app/${APP}/chamados/${f.numero}/eventos`, {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ evento: 'resolver' }),
    })
    const resolvidos = (await relogios(f.id)).filter((r) => r.meta === 'resolucao')
    resolvidos.every((r) => r.cumprido_em !== null)
        ? ok('resolvido: o relógio da resolução foi cumprido')
        : nao('a resolução não foi cumprida')

    await fetch(`${BASE}/api/app/${APP}/chamados/${f.numero}/mensagens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpo: 'Voltou a acontecer.' }),
    })
    const aposReabrir = (await relogios(f.id)).filter((r) => r.meta === 'resolucao')
    aposReabrir.length === 2 && aposReabrir.some((r) => r.cumprido_em === null)
        ? ok('reaberto: relógio NOVO de resolução, sem desfazer o cumprido')
        : nao(`relógios de resolução após reabrir: ${JSON.stringify(aposReabrir.map((r) => r.cumprido_em))}`)

    console.log('\n— quem pode varrer —')
    const semSessao = await fetch(`${BASE}/api/console/sla/vigiar`, { method: 'POST' })
    semSessao.status === 401
        ? ok('sem sessão: 401')
        : nao(`sem sessão devolveu ${semSessao.status}`)

    console.log(falhas === 0 ? '\n✓ Aceite dos prazos aprovado.' : `\n✗ ${falhas} falha(s).`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((erro) => {
    console.error('\n✗ aceite interrompido:', erro.message)
    process.exit(1)
})
