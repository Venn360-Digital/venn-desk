import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { z } from 'zod'

import { abrirChamado } from '../dados/abertura.ts'
import { agentePorEmail } from '../dados/agentes.ts'
import { formatarNumero } from '../dominio/numero.ts'
import type { Status } from '../dominio/estados.ts'
import { ErroDeDominio, ErroDeToken } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { comApp, comCliente, comSessaoDeAgente } from '../auth/middleware.ts'
import { conferirSenha, criarSessao, VALIDADE_DA_SESSAO_S } from '../auth/sessao-console.ts'

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

rotasInternas.use('/api/console/:app/*', comCliente, comSessaoDeAgente, comApp)

const esquemaDaFila = z.object({
    status: z.string().optional(),
    limite: z.coerce.number().int().min(1).max(200).optional(),
})

/** A fila do app. Sem `status`, traz o que está em aberto. */
rotasInternas.get('/api/console/:app/fila', async (c) => {
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

    return c.json({
        chamados: chamados.map((chamado) => ({
            numero: formatarNumero(prefixo, chamado.numero),
            assunto: chamado.assunto,
            status: chamado.status,
            tipo: chamado.tipo,
            prioridade: chamado.prioridade,
            nivel: chamado.nivel,
            assigneeId: chamado.assigneeId,
            atualizadoEm: chamado.atualizadoEm,
        })),
    })
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
rotasInternas.get('/api/console/:app/chamados/:numero', async (c) => {
    const chamado = await chamadoDaFila(c)
    const escopo = c.get('escopo')

    return c.json({
        chamado: {
            ...chamado,
            numero: formatarNumero(c.get('app').prefixo, chamado.numero),
        },
        mensagens: await escopo.mensagens.todas(chamado.id),
        eventos: await escopo.eventos.doChamado(chamado.id),
        anexos: await escopo.anexos.doChamado(chamado.id),
    })
})

const esquemaDaMensagemInterna = z.object({
    corpo: z.string().trim().min(1).max(10_000),
    visibilidade: z.enum(['PUBLICA', 'INTERNA']).default('INTERNA'),
})

rotasInternas.post('/api/console/:app/chamados/:numero/mensagens', async (c) => {
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

rotasInternas.post('/api/console/:app/chamados/:numero/eventos', async (c) => {
    const chamado = await chamadoDaFila(c)
    const agente = c.get('agente')

    const corpo = esquemaDoEvento.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('evento_invalido', 'Ação desconhecida.', 400)
    }

    const atualizado = await c
        .get('escopo')
        .chamados.aplicarEvento(chamado.id, corpo.data.evento, { ator: `agent:${agente.id}` })

    return c.json({ status: atualizado.status })
})

const esquemaDaAlteracao = z.object({
    tipo: z.enum(['DUVIDA', 'INCIDENTE', 'PROBLEMA', 'SOLICITACAO']).optional(),
    prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
    nivel: z.enum(['N1', 'N2', 'N3', 'HUMANO']).optional(),
    assigneeId: z.string().nullable().optional(),
})

rotasInternas.patch('/api/console/:app/chamados/:numero', async (c) => {
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
rotasInternas.post('/api/console/:app/chamados', async (c) => {
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
