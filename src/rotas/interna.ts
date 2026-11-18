import { Hono, type Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'

import { abrirChamado } from '../dados/abertura.ts'
import { agentePorEmail } from '../dados/agentes.ts'
import { alterarApp, appsAtivos, cadastrarApp } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { avisarPorEmail } from '../correio/avisar.ts'
import { publicarNaSala } from '../tempo-real/publicar.ts'
import { formatarNumero } from '../dominio/numero.ts'
import type { Status } from '../dominio/estados.ts'
import {
    METAS_PADRAO,
    resumoDoChamado,
    type Meta,
    type Prioridade,
    type Relogio,
} from '../dominio/sla.ts'
import { ErroDeDominio, ErroDeToken } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import type { Prisma } from '#prisma'
import { comApp, comCliente, comSessaoDeAgente } from '../auth/middleware.ts'
import { verificarSaude } from '../saude/verificar.ts'
import { vigiarPrazos } from '../sla/vigiar.ts'
import type { CaixaDeSaida } from '../correio/enviar.ts'
import { conferirSenha, criarSessao, podeAprovar, VALIDADE_DA_SESSAO_S } from '../auth/sessao-console.ts'

/**
 * A API interna — o que o Console consome, e o que a ponte do Slack vai chamar
 * na Fase 3.
 *
 * Aqui nota interna é visível, status muda à mão e um atendente abre chamado em
 * nome do cliente. Nenhuma rota daqui aprova issue nem publica em produção:
 * esses dois portões não existem como ferramenta, só como botão para humano
 * cadastrado (ADR 0006).
 */
export const rotasInternas = new Hono<Ambiente>()

const esquemaDoLogin = z.object({
    email: z.string().email(),
    senha: z.string().min(8).max(200),
})

rotasInternas.post('/api/console/sessao', comCliente, async (c) => {
    const corpo = esquemaDoLogin.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeToken('dados_invalidos', 'Informe e-mail e senha.')
    }

    const agente = await agentePorEmail(c.get('cliente'), corpo.data.email)

    /**
     * A conferência da senha roda mesmo quando o agente não existe, com um hash
     * descartável: sem isso, o tempo de resposta diria quais e-mails existem.
     */
    const hash =
        agente?.senhaHash ??
        'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const confere = await conferirSenha(corpo.data.senha, hash)

    if (agente === null || agente.senhaHash === null || !confere) {
        throw new ErroDeToken('credenciais_invalidas', 'E-mail ou senha incorretos.')
    }

    const sessao = await criarSessao(c.env.SEGREDO_SESSAO, {
        id: agente.id,
        nome: agente.nome,
        papel: agente.papel as 'AGENTE' | 'GESTOR' | 'ADMIN',
    })

    setCookie(c, 'venn_desk_sessao', sessao, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: VALIDADE_DA_SESSAO_S,
    })

    return c.json({ agente: { nome: agente.nome, papel: agente.papel } })
})

/**
 * **Por que `/api/console/app/<slug>/…` e não `/api/console/<slug>/…`.**
 *
 * Pela MESMA razão que `src/rotas/solicitante.ts` usa `/api/app/<slug>`, e com
 * a mesma consequência: um `:app` nessa posição captura qualquer primeiro
 * segmento. Com o caminho curto, `/api/console/apps/odontobox` entrava aqui com
 * `:app = "apps"`, e `/api/console/saude/verificar` com `:app = "saude"` — o
 * middleware procurava um app chamado "apps", não achava, e respondia 404 antes
 * de a rota certa ser alcançada. O `PATCH /api/console/apps/:slug` existia e
 * era inalcançável.
 *
 * O primeiro achado (Fase 1) foi tratado consertando UM caminho. Este é o mesmo
 * defeito reaparecendo no vizinho, o que diz que a regra não é "evite o nome
 * `console`": é que **um prefixo com parâmetro na raiz de um espaço reserva o
 * espaço inteiro**. Daí o segmento literal `app` em todos eles. Descoberto em
 * 17/11/2026 pelo aceite da saúde.
 */
rotasInternas.use('/api/console/app/:app/*', comCliente, comSessaoDeAgente, comApp)

const esquemaDaFilaUnica = z.object({
    app: z.string().optional(),
    empresa: z.string().optional(),
    conta: z.string().optional(),
    status: z.string().optional(),
    prioridade: z.string().optional(),
    numero: z.string().optional(),
    sla: z.enum(['em_risco', 'estourado']).optional(),
    limite: z.coerce.number().int().min(1).max(200).optional(),
})

/** `ODB-1042`, `odb-1042`, `1042` e `  1042 ` dão todos 1042. */
function numeroPedido(bruto: string | undefined): number | undefined {
    if (bruto === undefined) return undefined
    const digitos = bruto.replace(/\D+/g, '')
    if (digitos === '') return undefined
    const numero = Number(digitos)
    return Number.isSafeInteger(numero) && numero > 0 ? numero : undefined
}

/**
 * A fila ÚNICA, com os três apps na mesma tabela.
 *
 * **Ela não fura a regra do `app_id`.** A seção 6 exige que toda consulta
 * filtre por app, e a garantia disso é `escopoDoApp` (ver o cabeçalho de
 * `src/dados/escopo.ts`). Então a fila não faz uma consulta sem escopo: ela faz
 * UMA POR APP, cada uma escopada, e junta os resultados aqui. São três
 * consultas em vez de uma, em paralelo, e o isolamento continua estrutural —
 * não há caminho no código por onde um chamado de um app apareça na lista de
 * outro.
 *
 * A alternativa seria um `findMany` sem `appId`, mais rápido e o primeiro
 * buraco na garantia que sustenta o resto do sistema. Com três apps, a conta
 * não fecha a favor dela.
 */
rotasInternas.get('/api/console/fila', comCliente, comSessaoDeAgente, async (c) => {
    const filtro = esquemaDaFilaUnica.parse(Object.fromEntries(new URL(c.req.url).searchParams))
    const cliente = c.get('cliente')

    const todos = await appsAtivos(cliente)
    const apps = filtro.app === undefined ? todos : todos.filter((a) => a.slug === filtro.app)

    const status =
        filtro.status === undefined
            ? ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO', 'EM_ESPERA']
            : filtro.status.split(',')
    const prioridade = filtro.prioridade?.split(',') as
        | ('BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE')[]
        | undefined
    const numero = numeroPedido(filtro.numero)
    const agora = new Date()

    /// Teto POR APP, e não global: cortar no total faria o app que respondeu
    /// primeiro engolir a cota dos outros, e a fila esconderia um produto
    /// inteiro sem dizer.
    const porApp = Math.min(filtro.limite ?? 50, 200)

    const lotes = await Promise.all(
        apps.map(async (app) => {
            const escopo = escopoDoApp(cliente, app.id)

            const chamados = await escopo.chamados.listarParaFila({
                status: status as Status[],
                ...(prioridade === undefined ? {} : { prioridade }),
                ...(numero === undefined ? {} : { numero }),
                ...(filtro.empresa === undefined ? {} : { tenantId: filtro.empresa }),
                ...(filtro.conta === undefined ? {} : { accountId: filtro.conta }),
                limite: porApp,
            })

            const relogios = await escopo.sla.deChamados(chamados.map((ch) => ch.id))
            const porChamado = new Map<string, Relogio[]>()
            for (const linha of relogios) {
                const lista = porChamado.get(linha.ticketId) ?? []
                lista.push({
                    meta: linha.meta as Meta,
                    metaMin: linha.metaMin,
                    venceEm: linha.venceEm,
                    pausadoEm: linha.pausadoEm,
                    violadoEm: linha.violadoEm,
                    cumpridoEm: linha.cumpridoEm,
                })
                porChamado.set(linha.ticketId, lista)
            }

            return chamados.map((chamado) => ({
                numero: formatarNumero(app.prefixo, chamado.numero),
                sequencial: chamado.numero,
                assunto: chamado.assunto,
                app: { slug: app.slug, nome: app.nome, prefixo: app.prefixo },
                empresa: {
                    id: chamado.tenant.id,
                    nome: chamado.tenant.nome,
                    plano: chamado.tenant.plano,
                },
                conta: chamado.tenant.account,
                status: chamado.status,
                tipo: chamado.tipo,
                prioridade: chamado.prioridade,
                nivel: chamado.nivel,
                assigneeId: chamado.assigneeId,
                atualizadoEm: chamado.atualizadoEm,
                sla: resumoDoChamado(porChamado.get(chamado.id) ?? [], agora),
            }))
        })
    )

    const linhas = lotes
        .flat()
        .filter((linha) =>
            filtro.sla === undefined
                ? true
                : filtro.sla === 'em_risco'
                  ? linha.sla?.estado === 'em_risco'
                  : linha.sla?.estado === 'vencido' || linha.sla?.estado === 'violado'
        )
        .sort(
            (a: { atualizadoEm: Date }, b: { atualizadoEm: Date }) =>
                b.atualizadoEm.getTime() - a.atualizadoEm.getTime()
        )

    return c.json({ chamados: linhas })
})

/**
 * O que os seletores de filtro oferecem.
 *
 * Numa chamada só, e não três: a tela monta os seletores de uma vez, e pedir
 * app por app faria o primeiro aparecer preenchido enquanto os outros ainda
 * giram.
 */
rotasInternas.get('/api/console/filtros', comCliente, comSessaoDeAgente, async (c) => {
    const cliente = c.get('cliente')
    const apps = await appsAtivos(cliente)

    const porApp = await Promise.all(
        apps.map(async (app) => {
            const escopo = escopoDoApp(cliente, app.id)
            const [empresas, contas] = await Promise.all([
                escopo.empresas.listar(),
                escopo.contas.listar(),
            ])
            return { app, empresas, contas }
        })
    )

    return c.json({
        apps: apps.map((app) => ({ slug: app.slug, nome: app.nome, prefixo: app.prefixo })),
        empresas: porApp.flatMap(({ app, empresas }) =>
            empresas.map((e: { id: string; nome: string }) => ({
                id: e.id,
                nome: e.nome,
                app: app.slug,
            }))
        ),
        contas: porApp.flatMap(({ app, contas }) =>
            contas.map((ct: { id: string; nome: string }) => ({
                id: ct.id,
                nome: ct.nome,
                app: app.slug,
            }))
        ),
    })
})

const esquemaDaFila = z.object({
    status: z.string().optional(),
    limite: z.coerce.number().int().min(1).max(200).optional(),
    /// A visão "SLA em risco" da seção 5, sem precisar de visões salvas.
    sla: z.enum(['em_risco', 'estourado']).optional(),
})

/** A fila do app. Sem `status`, traz o que está em aberto. */
rotasInternas.get('/api/console/app/:app/fila', async (c) => {
    const filtro = esquemaDaFila.parse(Object.fromEntries(new URL(c.req.url).searchParams))

    const status: Status[] =
        filtro.status === undefined
            ? ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO', 'EM_ESPERA']
            : (filtro.status.split(',') as Status[])

    const chamados = await c.get('escopo').chamados.listar({
        status,
        ...(filtro.limite === undefined ? {} : { limite: filtro.limite }),
    })

    const prefixo = c.get('app').prefixo

    /**
     * Os relógios de TODOS os chamados numa consulta só, e o resumo calculado
     * aqui. A fila recarrega a cada 20 segundos: uma consulta por linha viraria
     * dezenas por recarga, e a tela mais usada seria a mais cara.
     */
    const agora = new Date()
    const relogios = await c.get('escopo').sla.deChamados(chamados.map((ch) => ch.id))
    const porChamado = new Map<string, Relogio[]>()
    for (const linha of relogios) {
        const lista = porChamado.get(linha.ticketId) ?? []
        lista.push({
            meta: linha.meta as Meta,
            metaMin: linha.metaMin,
            venceEm: linha.venceEm,
            pausadoEm: linha.pausadoEm,
            violadoEm: linha.violadoEm,
            cumpridoEm: linha.cumpridoEm,
        })
        porChamado.set(linha.ticketId, lista)
    }

    const linhas = chamados.map((chamado) => ({
        numero: formatarNumero(prefixo, chamado.numero),
        assunto: chamado.assunto,
        status: chamado.status,
        tipo: chamado.tipo,
        prioridade: chamado.prioridade,
        nivel: chamado.nivel,
        assigneeId: chamado.assigneeId,
        atualizadoEm: chamado.atualizadoEm,
        sla: resumoDoChamado(porChamado.get(chamado.id) ?? [], agora),
    }))

    /// `estourado` junta vencido e violado: para quem olha a fila é a mesma
    /// coisa — o prazo passou. A diferença é só se a varredura já marcou.
    const filtrados =
        filtro.sla === undefined
            ? linhas
            : linhas.filter((linha) =>
                  filtro.sla === 'em_risco'
                      ? linha.sla?.estado === 'em_risco'
                      : linha.sla?.estado === 'vencido' || linha.sla?.estado === 'violado'
              )

    return c.json({ chamados: filtrados })
})

const esquemaDaPolitica = z.object({
    primeiraRespostaMin: z.coerce.number().int().min(1).max(60 * 24 * 30),
    proximaRespostaMin: z.coerce.number().int().min(1).max(60 * 24 * 30),
    resolucaoMin: z.coerce.number().int().min(1).max(60 * 24 * 90),
})

/** As metas do app, com o padrão aparecendo onde não há política própria. */
rotasInternas.get('/api/console/app/:app/sla', async (c) => {
    const cadastradas = await c.get('escopo').sla.politicas()

    return c.json({
        prioridades: (['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'] as Prioridade[]).map(
            (prioridade) => ({
                prioridade,
                /// `propria: false` é informação, não detalhe: o atendente
                /// precisa saber se está vendo a política do app ou o padrão.
                propria: cadastradas[prioridade] !== undefined,
                ...(cadastradas[prioridade] ?? METAS_PADRAO[prioridade]),
            })
        ),
    })
})

rotasInternas.put('/api/console/app/:app/sla/:prioridade', async (c) => {
    const agente = c.get('agente')
    if (agente.papel === 'AGENTE') {
        throw new ErroDeDominio('sem_permissao', 'Agente não altera metas de SLA.', 403)
    }

    const prioridade = c.req.param('prioridade').toUpperCase()
    if (!['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'].includes(prioridade)) {
        throw new ErroDeDominio('prioridade_invalida', 'Prioridade desconhecida.', 400)
    }

    const corpo = esquemaDaPolitica.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('metas_invalidas', 'Metas em minutos, inteiras e positivas.', 400)
    }

    if (corpo.data.primeiraRespostaMin >= corpo.data.resolucaoMin) {
        /// Recusado e não "corrigido": uma meta de primeira resposta maior que
        /// a de resolução é erro de digitação, e adivinhar qual dos dois o
        /// gestor quis trocar seria pior que devolver o erro.
        throw new ErroDeDominio(
            'metas_incoerentes',
            'A primeira resposta tem de ser menor que a resolução.',
            400
        )
    }

    await c.get('escopo').sla.definirPolitica(prioridade as Prioridade, corpo.data)

    return c.json({ prioridade, ...corpo.data, propria: true })
})

/** Carrega o chamado pelo número, dentro do escopo do app. */
async function chamadoDaFila(c: Context<Ambiente>) {
    const numero = Number(c.req.param('numero'))
    const chamado =
        Number.isInteger(numero) && numero >= 1
            ? await c.get('escopo').chamados.porNumero(numero)
            : null

    if (chamado === null) {
        throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
    }

    return chamado
}

/** A tela do chamado: linha do tempo inteira, nota interna incluída. */
rotasInternas.get('/api/console/app/:app/chamados/:numero', async (c) => {
    const chamado = await chamadoDaFila(c)
    const escopo = c.get('escopo')
    const app = c.get('app')

    /**
     * A tela do chamado devolve o MESMO contexto que a fila mostra: empresa,
     * conta, app e prazo.
     *
     * Sem isso, clicar numa linha da fila PERDE informação — o atendente via de
     * quem era e quanto faltava, abria, e ficava só com o texto. Numa fila que
     * agora mistura três produtos, saber em qual deles se está é parte da
     * leitura, não um detalhe.
     */
    const [mensagens, eventos, anexos, relogios, empresa] = await Promise.all([
        escopo.mensagens.todas(chamado.id),
        escopo.eventos.doChamado(chamado.id),
        escopo.anexos.doChamado(chamado.id),
        escopo.sla.doChamado(chamado.id),
        escopo.empresas.porId(chamado.tenantId),
    ])

    return c.json({
        chamado: {
            ...chamado,
            numero: formatarNumero(app.prefixo, chamado.numero),
        },
        app: { slug: app.slug, nome: app.nome, prefixo: app.prefixo },
        empresa,
        sla: resumoDoChamado(
            relogios.map((linha) => ({
                meta: linha.meta as Meta,
                metaMin: linha.metaMin,
                venceEm: linha.venceEm,
                pausadoEm: linha.pausadoEm,
                violadoEm: linha.violadoEm,
                cumpridoEm: linha.cumpridoEm,
            })),
            new Date()
        ),
        mensagens,
        eventos,
        anexos,
    })
})

const esquemaDaMensagemInterna = z.object({
    corpo: z.string().trim().min(1).max(10_000),
    visibilidade: z.enum(['PUBLICA', 'INTERNA']).default('INTERNA'),
})

rotasInternas.post('/api/console/app/:app/chamados/:numero/mensagens', async (c) => {
    const chamado = await chamadoDaFila(c)
    const agente = c.get('agente')
    const escopo = c.get('escopo')

    const corpo = esquemaDaMensagemInterna.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Escreva a mensagem.', 400)
    }

    const mensagem = await escopo.mensagens.adicionar(
        {
            ticketId: chamado.id,
            autor: 'HUMANO',
            corpo: corpo.data.corpo,
            visibilidade: corpo.data.visibilidade,
            origem: 'CONSOLE',
            autorId: agente.id,
        },
        { ator: `agent:${agente.id}` }
    )

    /// Só mensagem pública mexe no estado: nota interna não é resposta ao cliente.
    const chamadoFinal =
        corpo.data.visibilidade === 'PUBLICA'
            ? await escopo.chamados.aplicarEvento(chamado.id, 'responder_usuario', {
                  ator: `agent:${agente.id}`,
              })
            : chamado

    /**
     * Nota interna NÃO é empurrada: a sala serve o widget do cliente, e o que
     * não deve chegar a ele não deve nem trafegar.
     */
    if (corpo.data.visibilidade === 'PUBLICA') {
        c.executionCtx.waitUntil(
            publicarNaSala(c.env.SALAS, chamado.id, { tipo: 'mensagem', resumo: 'suporte' })
        )
    }

    /// Só resposta pública avisa. Nota interna, não (seção 7).
    if (corpo.data.visibilidade === 'PUBLICA') {
        avisarPorEmail(c, 'atualizacao', {
            id: chamado.id,
            numero: chamado.numero,
            assunto: chamado.assunto,
            requesterId: chamado.requesterId,
            contexto: chamado.contexto,
        })
    }

    return c.json({ mensagem, status: chamadoFinal.status }, 201)
})

const esquemaDoEvento = z.object({
    evento: z.enum([
        'assumir',
        'escalar_engenharia',
        'engenharia_concluida',
        'resolver',
        'fechar',
    ]),
})

rotasInternas.post('/api/console/app/:app/chamados/:numero/eventos', async (c) => {
    const chamado = await chamadoDaFila(c)
    const agente = c.get('agente')

    const corpo = esquemaDoEvento.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('evento_invalido', 'Ação desconhecida.', 400)
    }

    const atualizado = await c
        .get('escopo')
        .chamados.aplicarEvento(chamado.id, corpo.data.evento, { ator: `agent:${agente.id}` })

    /**
     * Encerramento avisa; escalar e assumir não. "Foi para a engenharia" é
     * movimento interno, e a etapa já aparece no widget — mandar e-mail a cada
     * passo treina a pessoa a ignorar a caixa.
     */
    c.executionCtx.waitUntil(
        publicarNaSala(c.env.SALAS, chamado.id, { tipo: 'status', status: atualizado.status })
    )

    if (atualizado.status === 'RESOLVIDO' || atualizado.status === 'FECHADO') {
        avisarPorEmail(c, 'encerramento', {
            id: atualizado.id,
            numero: atualizado.numero,
            assunto: atualizado.assunto,
            requesterId: atualizado.requesterId,
            contexto: atualizado.contexto,
        })
    }

    return c.json({ status: atualizado.status })
})

const esquemaDaAlteracao = z.object({
    tipo: z.enum(['DUVIDA', 'INCIDENTE', 'PROBLEMA', 'SOLICITACAO']).optional(),
    prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
    nivel: z.enum(['N1', 'N2', 'N3', 'HUMANO']).optional(),
    assigneeId: z.string().nullable().optional(),
})

rotasInternas.patch('/api/console/app/:app/chamados/:numero', async (c) => {
    const chamado = await chamadoDaFila(c)
    const agente = c.get('agente')

    const corpo = esquemaDaAlteracao.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Nada a alterar.', 400)
    }

    const atualizado = await c
        .get('escopo')
        .chamados.alterar(chamado.id, corpo.data, { ator: `agent:${agente.id}` })

    return c.json({
        chamado: {
            numero: formatarNumero(c.get('app').prefixo, atualizado.numero),
            tipo: atualizado.tipo,
            prioridade: atualizado.prioridade,
            nivel: atualizado.nivel,
            assigneeId: atualizado.assigneeId,
        },
    })
})

const esquemaEmNomeDoCliente = z.object({
    tenantExternalId: z.string().min(1),
    requesterExternalId: z.string().min(1),
    nome: z.string().min(1),
    email: z.string().email(),
    assunto: z.string().trim().min(3).max(140),
    descricao: z.string().trim().min(5).max(10_000),
})

/**
 * O último recurso da seção 7: o cliente ligou, e o atendente abre o chamado em
 * nome dele. Fica registrado quem criou — é um chamado de origem CONSOLE, com o
 * ator sendo o agente, não o solicitante.
 */
rotasInternas.post('/api/console/app/:app/chamados', async (c) => {
    const agente = c.get('agente')

    const corpo = esquemaEmNomeDoCliente.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Faltam dados do cliente.', 400)
    }

    const solicitante = await c.get('escopo').solicitantes.garantir({
        tenantExternalId: corpo.data.tenantExternalId,
        tenantNome: corpo.data.tenantExternalId,
        requesterExternalId: corpo.data.requesterExternalId,
        nome: corpo.data.nome,
        email: corpo.data.email,
        papelNoTenant: 'member',
    })

    const chamado = await abrirChamado(c.get('cliente'), c.get('app').id, {
        tenantId: solicitante.tenantId,
        requesterId: solicitante.requesterId,
        assunto: corpo.data.assunto,
        descricao: corpo.data.descricao,
        origem: 'CONSOLE',
        ator: `agent:${agente.id}`,
    })

    return c.json(
        { chamado: { numero: formatarNumero(c.get('app').prefixo, chamado.numero) } },
        201
    )
})

const esquemaDoApp = z.object({
    slug: z
        .string()
        .trim()
        .min(2)
        .max(32)
        .regex(/^[a-z][a-z0-9-]*$/, 'use minúsculas, números e hífen'),
    nome: z.string().trim().min(2).max(80),
    prefixo: z
        .string()
        .trim()
        .min(2)
        .max(5)
        .regex(/^[A-Za-z]+$/, 'só letras'),
    chavePublicaJwk: z.record(z.string(), z.unknown()),
    repositorio: z.string().trim().max(200).nullish(),
    /// Endereço público do app e o que a verificação de saúde consulta. O
    /// `url()` recusa caminho relativo de propósito: a sondagem sai do Worker
    /// do Venn Desk, então endereço sem origem não alcança nada.
    urlApp: z.string().trim().url().max(300).nullish(),
    urlSaude: z.string().trim().url().max(300).nullish(),
    canalSuporte: z.string().trim().max(80).nullish(),
    canalEngenharia: z.string().trim().max(80).nullish(),
    modoSombra: z.boolean().optional(),
})

/**
 * Roda a verificação de saúde agora, sem esperar o Cron Trigger.
 *
 * Existe por dois motivos práticos: o aceite precisa de um gatilho (não há como
 * disparar um cron da Cloudflare de fora), e num incidente alguém vai querer
 * reverificar sem esperar o próximo minuto. Só gestor e admin — ela envia
 * e-mail de alerta e pode abrir problema.
 */
rotasInternas.post('/api/console/saude/verificar', comCliente, comSessaoDeAgente, async (c) => {
    const agente = c.get('agente')
    if (agente.papel === 'AGENTE') {
        throw new ErroDeDominio('sem_permissao', 'Só gestor ou admin verifica saúde.', 403)
    }

    const vereditos = await verificarSaude(c.get('cliente'), {
        caixa: c.env.EMAIL as unknown as CaixaDeSaida | undefined,
        remetente: {
            email: c.env.EMAIL_REMETENTE ?? 'suporte@mail.venn360.com',
            nome: 'Venn Desk · Alertas',
        },
        urlStatus: c.env.URL_STATUS,
    })

    return c.json({ vereditos })
})

/**
 * Roda a varredura de prazos agora, sem esperar o Cron Trigger.
 *
 * **Sem parâmetro de tempo, de propósito.** Seria cômodo aceitar um `agora` e
 * deixar o aceite fabricar o futuro — e seria uma porta para marcar a fila
 * inteira como violada com uma requisição. O aceite envelhece o relógio no
 * banco, onde ele já tem acesso; a rota só olha o relógio de verdade.
 */
rotasInternas.post('/api/console/sla/vigiar', comCliente, comSessaoDeAgente, async (c) => {
    const agente = c.get('agente')
    if (agente.papel === 'AGENTE') {
        throw new ErroDeDominio('sem_permissao', 'Só gestor ou admin varre prazos.', 403)
    }

    return c.json({ estouros: await vigiarPrazos(c.get('cliente')) })
})

/** Quem está logado. É como a SPA do Console sabe se há sessão. */
rotasInternas.get('/api/console/sessao', comSessaoDeAgente, (c) => {
    const agente = c.get('agente')
    return c.json({ agente: { nome: agente.nome, papel: agente.papel }, podeAprovar: podeAprovar(agente) })
})

rotasInternas.delete('/api/console/sessao', (c) => {
    deleteCookie(c, 'venn_desk_sessao', { path: '/' })
    return c.json({ ok: true })
})

/**
 * Os apps atendidos. Esta rota NÃO é escopada por app — ela é o cadastro dos
 * apps, e por isso passa por `src/dados/apps.ts`, o único lugar fora do escopo
 * que fala com o banco (ver `scripts/lint-isolamento.mjs`).
 */
rotasInternas.get('/api/console/apps', comCliente, comSessaoDeAgente, async (c) => {
    const apps = await appsAtivos(c.get('cliente'))

    return c.json({
        apps: apps.map((app) => ({
            slug: app.slug,
            nome: app.nome,
            prefixo: app.prefixo,
            repositorio: app.repositorio,
            urlApp: app.urlApp,
            urlSaude: app.urlSaude,
            canalSuporte: app.canalSuporte,
            canalEngenharia: app.canalEngenharia,
            modoSombra: app.modoSombra,
            proximoNumero: app.proximoNumero,
            /// A chave pública não é segredo, mas não serve à tela: só a
            /// impressão digital, para conferir que é a esperada.
            chaveCadastrada: Object.keys((app.chavePublicaJwk ?? {}) as object).length > 0,
        })),
    })
})

rotasInternas.post('/api/console/apps', comCliente, comSessaoDeAgente, async (c) => {
    const agente = c.get('agente')
    if (agente.papel !== 'ADMIN') {
        throw new ErroDeDominio('sem_permissao', 'Só administrador cadastra app.', 403)
    }

    const corpo = esquemaDoApp.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio(
            'dados_invalidos',
            corpo.error.issues[0]?.message ?? 'Dados do app inválidos.',
            400
        )
    }

    const app = await cadastrarApp(c.get('cliente'), {
        slug: corpo.data.slug,
        nome: corpo.data.nome,
        prefixo: corpo.data.prefixo,
        chavePublicaJwk: corpo.data.chavePublicaJwk as Prisma.InputJsonValue,
        ...(corpo.data.repositorio === undefined ? {} : { repositorio: corpo.data.repositorio }),
        ...(corpo.data.canalSuporte === undefined ? {} : { canalSuporte: corpo.data.canalSuporte }),
        ...(corpo.data.canalEngenharia === undefined
            ? {}
            : { canalEngenharia: corpo.data.canalEngenharia }),
        ...(corpo.data.modoSombra === undefined ? {} : { modoSombra: corpo.data.modoSombra }),
    }).catch((erro: unknown) => {
        /// Slug ou prefixo repetido é erro de quem cadastra, não falha interna.
        const codigo = (erro as { code?: string }).code
        if (codigo === 'P2002') {
            throw new ErroDeDominio('ja_existe', 'Já existe app com esse slug ou prefixo.', 409)
        }
        throw erro
    })

    return c.json({ app: { slug: app.slug, prefixo: app.prefixo } }, 201)
})

rotasInternas.patch('/api/console/apps/:slug', comCliente, comSessaoDeAgente, async (c) => {
    const agente = c.get('agente')
    if (agente.papel === 'AGENTE') {
        throw new ErroDeDominio('sem_permissao', 'Agente não altera cadastro de app.', 403)
    }

    const corpo = esquemaDoApp
        .partial()
        .omit({ slug: true, prefixo: true })
        .safeParse(await c.req.json().catch(() => null))

    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Nada a alterar.', 400)
    }

    /// A chave sai do spread: o tipo que o zod infere para um objeto livre não
    /// é o `InputJsonValue` do Prisma, e juntar os dois num spread não compila.
    const { chavePublicaJwk, ...resto } = corpo.data

    const app = await alterarApp(c.get('cliente'), c.req.param('slug'), {
        ...resto,
        ...(chavePublicaJwk === undefined
            ? {}
            : { chavePublicaJwk: chavePublicaJwk as Prisma.InputJsonValue }),
    })

    if (app === null) throw new ErroDeDominio('app_nao_encontrado', 'App não encontrado.', 404)

    return c.json({ app: { slug: app.slug, nome: app.nome, modoSombra: app.modoSombra } })
})
