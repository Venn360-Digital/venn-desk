import { formatarNumero } from '../dominio/numero.ts'
import type { EscopoDoApp } from '../dados/escopo.ts'

import { montar, type DadosDoEmail, type Idioma, type Momento } from './modelos.ts'

/**
 * O envio, pelo Cloudflare Email Sending — binding `send_email`,
 * `env.EMAIL.send` (decisão de 15/11/2026, seção 7).
 *
 * **O e-mail só SAI.** Nada entra: não há caixa de entrada, não há parser de
 * resposta. O remetente avisa isso no corpo e leva de volta ao app.
 *
 * **O destinatário nunca vem do corpo da requisição.** Sai do cadastro do
 * solicitante, pelo escopo do app — é o que impede a rota de virar relay.
 * Enviar para destinatário arbitrário, que é o nosso caso, exige Workers Paid.
 *
 * **Nunca derruba a operação.** Falha de e-mail é registrada na trilha e
 * engolida: o chamado existe, a resposta já foi gravada, e transformar um
 * problema de entrega num 500 na tela do cliente seria trocar um aviso perdido
 * por um atendimento perdido.
 */

/** Janela de agrupamento: avisos em sequência viram um só (seção 7). */
export const JANELA_DE_AGRUPAMENTO_MS = 2 * 60 * 1000

export interface Remetente {
    email: string
    nome: string
}

export interface CaixaDeSaida {
    send(mensagem: {
        from: { email: string; name: string }
        to: string
        subject: string
        text: string
        html: string
        replyTo?: string
    }): Promise<void>
}

export interface PedidoDeEmail {
    momento: Momento
    escopo: EscopoDoApp
    caixa: CaixaDeSaida | undefined
    remetente: Remetente
    urlBase: string
    app: { slug: string; nome: string; prefixo: string }
    chamado: { id: string; numero: number; assunto: string }
    destinatario: { nome: string; email: string }
    idioma: Idioma
    /** Mensagens públicas novas, já filtradas por quem chama. */
    mensagens: { autor: string; corpo: string }[]
}

/**
 * Agrupa pela trilha de auditoria, não por tabela nova: o último evento
 * `email:<momento>` daquele chamado diz quando avisamos pela última vez.
 *
 * Abertura e encerramento NUNCA são agrupados — acontecem uma vez e são os dois
 * momentos em que o silêncio é pior que o excesso.
 */
async function avisadoHaPouco(pedido: PedidoDeEmail): Promise<boolean> {
    if (pedido.momento !== 'atualizacao') return false

    const eventos = await pedido.escopo.eventos.doChamado(pedido.chamado.id)
    const ultimo = eventos
        .filter((e) => e.evento === 'email:atualizacao')
        .at(-1)

    if (ultimo === undefined) return false
    return Date.now() - new Date(ultimo.criadoEm).getTime() < JANELA_DE_AGRUPAMENTO_MS
}

export async function enviarAviso(pedido: PedidoDeEmail): Promise<'enviado' | 'agrupado' | 'sem_caixa' | 'falhou'> {
    if (await avisadoHaPouco(pedido)) {
        /**
         * Não é só pular: o próximo aviso leva TODAS as mensagens desde o
         * último evento de e-mail, porque quem monta o pedido busca por essa
         * marca. Agrupar é adiar com memória, não descartar.
         */
        return 'agrupado'
    }

    const numero = formatarNumero(pedido.app.prefixo, pedido.chamado.numero)
    const dados: DadosDoEmail = {
        numero,
        assunto: pedido.chamado.assunto,
        nomeDoApp: pedido.app.nome,
        nomeDoUsuario: pedido.destinatario.nome,
        link: `${pedido.urlBase}/chamados/${pedido.chamado.numero}`,
        mensagens: pedido.mensagens,
    }

    const { assunto, texto, html } = montar(pedido.momento, pedido.idioma, dados)

    if (pedido.caixa === undefined) {
        /// Sem binding configurado — ambiente onde o domínio de envio ainda não
        /// foi onboardado. Registra e segue: a operação não depende disto.
        await pedido.escopo.eventos.registrar({
            ticketId: pedido.chamado.id,
            ator: 'sistema',
            evento: `email:${pedido.momento}:sem_caixa`,
            depois: { assunto },
        })
        return 'sem_caixa'
    }

    try {
        await pedido.caixa.send({
            /// `from` como objeto, não como string "Nome <end>": o construtor do
            /// binding não parseia esse formato.
            from: { email: pedido.remetente.email, name: pedido.remetente.nome },
            to: pedido.destinatario.email,
            subject: assunto,
            text: texto,
            html,
        })

        await pedido.escopo.eventos.registrar({
            ticketId: pedido.chamado.id,
            ator: 'sistema',
            evento: `email:${pedido.momento}`,
            depois: { assunto, mensagens: pedido.mensagens.length },
        })

        return 'enviado'
    } catch (erro) {
        /**
         * O código do erro é o que diz se o problema é configuração
         * (`E_SENDER_NOT_VERIFIED`) ou volume (`E_RATE_LIMIT_EXCEEDED`).
         * Guardar a mensagem inteira traria endereço para a trilha.
         */
        const codigo = (erro as { code?: string }).code ?? 'desconhecido'
        await pedido.escopo.eventos.registrar({
            ticketId: pedido.chamado.id,
            ator: 'sistema',
            evento: `email:${pedido.momento}:falhou`,
            depois: { codigo },
        })
        console.error('[correio] falha ao enviar:', codigo)
        return 'falhou'
    }
}

/** As mensagens públicas desde o último aviso por e-mail daquele chamado. */
export async function mensagensDesdeOUltimoAviso(
    escopo: EscopoDoApp,
    ticketId: string
): Promise<{ autor: string; corpo: string }[]> {
    const [eventos, mensagens] = await Promise.all([
        escopo.eventos.doChamado(ticketId),
        escopo.mensagens.publicas(ticketId),
    ])

    const ultimoAviso = eventos.filter((e) => e.evento.startsWith('email:')).at(-1)
    const corte = ultimoAviso === undefined ? 0 : new Date(ultimoAviso.criadoEm).getTime()

    return mensagens
        .filter((m) => new Date(m.criadoEm).getTime() > corte)
        .filter((m) => m.autor === 'IA' || m.autor === 'HUMANO')
        .map((m) => ({ autor: m.autor === 'IA' ? 'Suporte' : 'Suporte', corpo: m.corpo }))
}
