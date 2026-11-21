import type { EscopoDoApp } from '../dados/escopo.ts'
import type { Autor } from '../dados/escopo.ts'
import { postar, type ConfigDoSlack } from './cliente.ts'
import {
    mensagemDeAbertura,
    mensagemDeAtualizacao,
    mensagemDeEngenharia,
    type DadosDaAbertura,
    type DadosDaEngenharia,
} from './mensagens.ts'
import { neutralizar } from './neutralizar.ts'

/**
 * A ponte entre o Venn Desk e o Slack (seção 8).
 *
 * **Quem é a fonte da verdade.** O chamado. O Slack é uma superfície de
 * trabalho: tudo o que acontece lá vira evento e mensagem aqui, e nada existe
 * só lá. É por isso que a thread guarda o `ts` do Slack e não o contrário.
 *
 * **Falhar aqui não derruba nada.** Nenhuma função desta ponte lança: um Slack
 * fora do ar, um token errado ou um canal apagado não podem impedir um chamado
 * de ser aberto nem uma resposta de ser enviada. O que não espelha vira log, e
 * o Console continua mostrando a verdade.
 *
 * **O que NUNCA vai para o Slack.** O texto do solicitante sem rótulo e sem
 * neutralizar, anexo e dado pessoal. O conteúdo do chamado o Claude lê por
 * ferramenta, em campo marcado como dado — ver `neutralizar.ts` e a mensagem de
 * abertura.
 */

export interface ResultadoDoEspelho {
    espelhou: boolean
    /** Por que não espelhou, quando não espelhou. Vai para o log, não para o cliente. */
    motivo?: 'sem_canal' | 'sem_token' | 'ja_existia' | 'falha_no_slack'
}

/**
 * Posta o chamado no canal de suporte do app e registra a thread.
 *
 * Idempotente de propósito: a abertura pode ser espelhada duas vezes (uma
 * reentrega de fila, um clique duplo no widget), e duas threads para o mesmo
 * chamado dividiriam a conversa em duas — o atendente responderia numa e o
 * cliente leria a outra.
 */
export async function espelharAbertura(p: {
    escopo: EscopoDoApp
    config: ConfigDoSlack
    canal: string | null
    dados: DadosDaAbertura
}): Promise<ResultadoDoEspelho> {
    if (p.canal === null || p.canal === '') return { espelhou: false, motivo: 'sem_canal' }

    const jaTem = await p.escopo.threadsDoSlack.porChamado(p.dados.chamadoId)
    if (jaTem !== null) return { espelhou: false, motivo: 'ja_existia' }

    const resposta = await postar(p.config, { canal: p.canal, mensagem: mensagemDeAbertura(p.dados) })
    if (!resposta.ok) {
        console.error('[slack] não espelhei a abertura:', resposta.erro)
        return { espelhou: false, motivo: resposta.erro === 'sem_token' ? 'sem_token' : 'falha_no_slack' }
    }

    await p.escopo.threadsDoSlack.registrar({
        ticketId: p.dados.chamadoId,
        canal: resposta.canal,
        threadTs: resposta.ts,
    })

    return { espelhou: true }
}

/**
 * Posta uma novidade na thread do chamado (Venn Desk → Slack).
 *
 * O que vai: que ALGO aconteceu e o convite a ler pela ferramenta. O conteúdo
 * não vai, nem quando é nosso — quem lê o chamado é quem tem o Console aberto
 * ou o MCP na mão, e o canal é lido por modelo.
 *
 * Silencioso quando não há thread: um chamado aberto antes do Slack existir, ou
 * num app sem canal, não é um erro a reportar.
 */
export async function avisarNaThread(p: {
    escopo: EscopoDoApp
    config: ConfigDoSlack
    chamadoId: string
    /** Uma linha, escrita por nós. */
    novidade: string
    numero: string
}): Promise<{ postou: boolean; motivo?: string }> {
    const thread = await p.escopo.threadsDoSlack.porChamado(p.chamadoId)
    if (thread === null) return { postou: false, motivo: 'sem_thread' }

    const resposta = await postar(p.config, {
        canal: thread.canal,
        naThread: thread.threadTs,
        mensagem: mensagemDeAtualizacao({ numero: p.numero, novidade: p.novidade }),
    })

    if (!resposta.ok) {
        if (resposta.erro !== 'sem_token') console.error('[slack] aviso na thread falhou:', resposta.erro)
        return { postou: false, motivo: resposta.erro }
    }

    return { postou: true }
}

/**
 * Abre a thread do defeito no canal de ENGENHARIA (seção 8).
 *
 * Canal separado, e isso é a defesa principal: o canal de engenharia tem o
 * repositório ligado, e o de suporte tem o texto de quem abriu o chamado. O que
 * cruza a fronteira é o resumo escrito pelo N1, nunca o relato original.
 *
 * Idempotente: um chamado escalado duas vezes (o N1 insiste, um humano repete
 * pelo Console) continua com uma thread só. Duas dividiriam o diagnóstico.
 */
export async function abrirThreadDeEngenharia(p: {
    escopo: EscopoDoApp
    config: ConfigDoSlack
    canal: string | null
    dados: DadosDaEngenharia
}): Promise<{ abriu: boolean; motivo?: string }> {
    if (p.canal === null || p.canal === '') return { abriu: false, motivo: 'sem_canal' }

    const thread = await p.escopo.threadsDoSlack.porChamado(p.dados.chamadoId)
    if (thread !== null && thread.threadTsEngenharia !== null) return { abriu: false, motivo: 'ja_existia' }

    const resposta = await postar(p.config, { canal: p.canal, mensagem: mensagemDeEngenharia(p.dados) })
    if (!resposta.ok) {
        if (resposta.erro !== 'sem_token') console.error('[slack] thread de engenharia não abriu:', resposta.erro)
        return { abriu: false, motivo: resposta.erro }
    }

    /**
     * Se o chamado ainda não tem thread de suporte (app sem canal de suporte,
     * ou chamado anterior à ponte), o vínculo de engenharia não tem onde morar:
     * `slack_threads` é uma linha por chamado. Registra a de suporte primeiro,
     * apontando para a própria mensagem de engenharia — é o que mantém o
     * caminho de volta funcionando para reação e nota.
     */
    if (thread === null) {
        await p.escopo.threadsDoSlack.registrar({
            ticketId: p.dados.chamadoId,
            canal: resposta.canal,
            threadTs: resposta.ts,
        })
    }

    await p.escopo.threadsDoSlack.registrarEngenharia(p.dados.chamadoId, {
        canal: resposta.canal,
        threadTs: resposta.ts,
    })

    return { abriu: true }
}

export type DestinoDaMensagem = 'nota-interna' | 'ignorada'

export interface MensagemDaThread {
    /** O canal e o `ts` da thread-raiz: é por eles que achamos o chamado. */
    canal: string
    threadTs: string
    /** O `ts` desta mensagem. Vira `externoId`, e é o que impede a duplicata. */
    ts: string
    /** O id do usuário do Slack (`U…`). */
    usuario: string
    texto: string
    /** `true` quando o próprio Bridge escreveu. */
    doBot: boolean
}

/**
 * Uma mensagem na thread do chamado vira NOTA INTERNA.
 *
 * É o padrão da seção 8, e a escolha é deliberada: o que se escreve numa thread
 * de suporte é conversa entre colegas. Para falar com o cliente existe botão e
 * ferramenta, e o caminho mais curto nunca pode ser o que alcança quem está do
 * lado de fora — um comentário interno publicado por engano é irreversível.
 *
 * O autor tem de estar cadastrado em `agents` pelo `slackId`. Sem isso qualquer
 * convidado do canal escreveria na trilha de um chamado com a autoria de
 * ninguém.
 */
export async function notaDaThread(p: {
    escopo: EscopoDoApp
    mensagem: MensagemDaThread
    /** O agente dono daquele `slackId`, ou nulo se ninguém. */
    agente: { id: string; nome: string } | null
}): Promise<{ destino: DestinoDaMensagem; motivo?: string }> {
    const m = p.mensagem

    /// O eco do próprio Bridge não volta para dentro: cada postagem nossa
    /// geraria uma nota, que geraria outra postagem.
    if (m.doBot) return { destino: 'ignorada', motivo: 'do_bot' }

    const texto = m.texto.trim()
    if (texto === '') return { destino: 'ignorada', motivo: 'vazia' }

    const thread = await p.escopo.threadsDoSlack.porThread(m.canal, m.threadTs)
    if (thread === null) return { destino: 'ignorada', motivo: 'thread_sem_chamado' }

    if (p.agente === null) return { destino: 'ignorada', motivo: 'autor_nao_cadastrado' }

    try {
        await p.escopo.mensagens.adicionar(
            {
                ticketId: thread.ticketId,
                autor: 'HUMANO',
                /**
                 * O texto vem do Slack, que é interno, mas passa pelo mesmo
                 * neutralizador do resto: um atendente colando o relato do
                 * cliente dentro da thread traria de volta o texto de fora, e
                 * ele não deve virar linha com significado na trilha.
                 */
                corpo: neutralizar(texto, 3_000),
                visibilidade: 'INTERNA',
                origem: 'SLACK',
                autorId: p.agente.id,
                externoId: m.ts,
            },
            { ator: `agent:${p.agente.id}` }
        )
    } catch (erro) {
        /**
         * Colisão do índice único `(appId, externoId)`: é a reentrega do Slack
         * chegando de novo, e o certo é não fazer nada. Qualquer outro erro
         * também não pode derrubar a ponte — o Slack repetiria o evento para
         * sempre.
         */
        const codigo = (erro as { code?: string }).code
        if (codigo === 'P2002') return { destino: 'ignorada', motivo: 'reentrega' }
        console.error('[slack] não gravei a nota da thread:', erro)
        return { destino: 'ignorada', motivo: 'falha_ao_gravar' }
    }

    return { destino: 'nota-interna' }
}

export type AcaoDoBotao = 'assumir' | 'escalar_engenharia' | 'resolver'

/**
 * Os botões da mensagem de abertura que agem sozinhos.
 *
 * "Responder ao usuário" não está aqui porque ele não age: abre um modal, e
 * quem age é o envio dele. A separação é deliberada — um clique que já mandasse
 * mensagem ao cliente seria um clique sem volta.
 *
 * O `chamadoId` vem do `value` do botão, que fomos NÓS que montamos quando a
 * mensagem foi postada. Mesmo assim ele é conferido contra o escopo do app
 * antes de qualquer escrita: o payload chega pela rede, e um id de outro app
 * não pode virar escrita aqui.
 */
export async function aplicarBotao(p: {
    escopo: EscopoDoApp
    acao: AcaoDoBotao
    chamadoId: string
    agente: { id: string; nome: string } | null
}): Promise<{ feito: boolean; motivo?: string }> {
    if (p.agente === null) return { feito: false, motivo: 'autor_nao_cadastrado' }

    const chamado = await p.escopo.chamados.porId(p.chamadoId)
    if (chamado === null) return { feito: false, motivo: 'chamado_de_outro_app' }

    const autor: Autor = { ator: `agent:${p.agente.id}` }

    try {
        if (p.acao === 'assumir') {
            await p.escopo.chamados.alterar(p.chamadoId, { assigneeId: p.agente.id }, autor)
            await p.escopo.chamados.aplicarEvento(p.chamadoId, 'assumir', autor)
        } else if (p.acao === 'escalar_engenharia') {
            await p.escopo.chamados.alterar(p.chamadoId, { nivel: 'N2' }, autor)
            await p.escopo.chamados.aplicarEvento(p.chamadoId, 'escalar_engenharia', autor)
        } else {
            await p.escopo.chamados.aplicarEvento(p.chamadoId, 'resolver', autor)
        }
    } catch (erro) {
        console.error(`[slack] botão ${p.acao} recusado:`, erro instanceof Error ? erro.message : erro)
        return { feito: false, motivo: 'transicao_recusada' }
    }

    return { feito: true }
}

/**
 * A resposta escrita no modal, que é a ÚNICA que sai do Slack para o cliente.
 *
 * Em modo sombra ela não sai: fica rascunho, como a da IA. O atendente que
 * clicou é humano, mas o modo sombra não é sobre quem escreve — é sobre o app
 * ainda não ter autorizado saída automática pela ponte, e o Console é onde se
 * aprova.
 */
export async function responderPelaThread(p: {
    escopo: EscopoDoApp
    chamadoId: string
    texto: string
    agente: { id: string; nome: string } | null
    /** `App.modoSombra`. */
    modoSombra: boolean
}): Promise<{ enviada: boolean; motivo?: string }> {
    if (p.agente === null) return { enviada: false, motivo: 'autor_nao_cadastrado' }

    const texto = p.texto.trim()
    if (texto === '') return { enviada: false, motivo: 'vazia' }

    const chamado = await p.escopo.chamados.porId(p.chamadoId)
    if (chamado === null) return { enviada: false, motivo: 'chamado_de_outro_app' }

    try {
        await p.escopo.mensagens.adicionar(
            {
                ticketId: p.chamadoId,
                autor: 'HUMANO',
                corpo: texto,
                visibilidade: 'PUBLICA',
                origem: 'SLACK',
                autorId: p.agente.id,
                rascunho: p.modoSombra,
            },
            { ator: `agent:${p.agente.id}` }
        )
        if (!p.modoSombra) {
            await p.escopo.chamados.aplicarEvento(p.chamadoId, 'responder_usuario', { ator: `agent:${p.agente.id}` })
        }
    } catch (erro) {
        console.error('[slack] resposta ao cliente não gravada:', erro)
        return { enviada: false, motivo: 'falha_ao_gravar' }
    }

    return { enviada: !p.modoSombra }
}

/** 👀 assume o chamado, ✅ resolve. Só de quem está em `agents` (seção 8). */
export const REACOES: Record<string, 'assumir' | 'resolver'> = {
    eyes: 'assumir',
    white_check_mark: 'resolver',
    heavy_check_mark: 'resolver',
}

export async function aplicarReacao(p: {
    escopo: EscopoDoApp
    canal: string
    /** O `ts` da mensagem que recebeu a reação. Só a raiz da thread conta. */
    ts: string
    reacao: string
    agente: { id: string; nome: string } | null
}): Promise<{ acao: 'assumir' | 'resolver' | null; motivo?: string }> {
    const acao = REACOES[p.reacao]
    if (acao === undefined) return { acao: null, motivo: 'reacao_sem_efeito' }
    if (p.agente === null) return { acao: null, motivo: 'autor_nao_cadastrado' }

    /**
     * Só na mensagem-raiz.
     *
     * Reagir a uma mensagem qualquer dentro da thread é gesto comum ("vi",
     * "concordo"); se isso resolvesse o chamado, o Desk fecharia chamados por
     * educação alheia.
     */
    const thread = await p.escopo.threadsDoSlack.porThread(p.canal, p.ts)
    if (thread === null) return { acao: null, motivo: 'nao_e_a_raiz' }

    const autor: Autor = { ator: `agent:${p.agente.id}` }

    try {
        if (acao === 'assumir') {
            await p.escopo.chamados.alterar(thread.ticketId, { assigneeId: p.agente.id }, autor)
            await p.escopo.chamados.aplicarEvento(thread.ticketId, 'assumir', autor)
        } else {
            await p.escopo.chamados.aplicarEvento(thread.ticketId, 'resolver', autor)
        }
    } catch (erro) {
        /**
         * A máquina de estados recusa o que não cabe (resolver o que já está
         * fechado, por exemplo), e recusa é resposta legítima: o gesto no Slack
         * não manda no ciclo do chamado. Fica no log e a thread segue.
         */
        console.error(`[slack] reação ${p.reacao} recusada:`, erro instanceof Error ? erro.message : erro)
        return { acao: null, motivo: 'transicao_recusada' }
    }

    return { acao }
}
