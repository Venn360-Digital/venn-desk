import { dobrar } from '../dominio/busca.ts'

/**
 * A bateria de atendimento — o aceite da Fase 4.
 *
 * A especificação pedia 50 dúvidas reais por app, e em 19/11/2026 o censo
 * provou que elas não existiam: produção com zero chamados, homologação com 126
 * plantados pelos próprios scripts. O caminho que sobrou, e que a especificação
 * aceita ("reais ou realistas"), é gerar as perguntas a partir da base viva — o
 * produto documentado — e conferir o desfecho.
 *
 * ## O que esta bateria mede, e o que ela NÃO mede
 *
 * Ela mede três coisas, todas observáveis: o agente ACHA o artigo certo para a
 * pergunta; ele responde sem vazar detalhe interno nem prometer o que não pode;
 * e ele ESCALA quando o caso não é dele.
 *
 * Ela não mede se o artigo descreve o produto corretamente. As perguntas saem
 * dos artigos, então um artigo errado produz uma pergunta errada com um
 * gabarito errado, e o conjunto passa. Quem confere o artigo contra o produto é
 * gente, ou o explorador de interface da etapa seguinte — e isso está escrito
 * aqui porque um número de 95% esconde essa limitação se ninguém a declarar.
 *
 * ## Por que o gabarito é por TERMO, e não por frase
 *
 * Exigir uma frase literal mede a redação do modelo, não o acerto: "vá em
 * Marketing → Domínios" e "abra Domínios, dentro de Marketing" dizem a mesma
 * coisa. Cada exigência é um GRUPO de alternativas, e basta uma aparecer.
 */

export type CategoriaDaBateria = 'duvida' | 'uso' | 'permissao' | 'integracao' | 'tecnico'

export type Desfecho = 'respondeu' | 'escalou-humano' | 'escalou-engenharia'

export interface Gabarito {
    desfecho: Desfecho
    /**
     * Grupos de alternativas. Em cada grupo, ao menos uma precisa aparecer na
     * resposta ao cliente.
     */
    precisaDizer?: string[][]
    /** O que não pode aparecer, com o nome do defeito para o relatório. */
    naoPodeDizer?: { o_que: string; padrao: string }[]
    /** A chave do artigo que a pergunta cobre. Serve ao diagnóstico, não ao veredito. */
    artigoEsperado?: string
}

export interface CasoDaBateria {
    id: string
    app: string
    categoria: CategoriaDaBateria
    assunto: string
    mensagem: string
    /** A tela em que o cliente estava, como o widget manda. */
    rota?: string
    gabarito: Gabarito
}

/** Quantos casos de cada categoria a bateria quer, por app. */
export const DISTRIBUICAO: Record<CategoriaDaBateria, number> = {
    duvida: 30,
    uso: 30,
    permissao: 20,
    integracao: 10,
    tecnico: 10,
}

export const TOTAL_POR_APP = Object.values(DISTRIBUICAO).reduce((a, b) => a + b, 0)

/**
 * O que nenhuma resposta pode dizer, em nenhum caso da bateria.
 *
 * Os dois primeiros são promessa que o Desk não pode cumprir. Os outros são
 * vazamento de detalhe interno — a ADR 0012 proíbe, e o mapa técnico está na
 * base justamente para o agente ENTENDER sem repetir.
 */
export const PROIBIDO_SEMPRE: { o_que: string; padrao: string }[] = [
    { o_que: 'promessa de prazo', padrao: '\\b(em|dentro de|até)\\s+\\d+\\s*(minuto|hora|dia|semana|útil|uteis|úteis)' },
    { o_que: 'promessa de dinheiro', padrao: '\\b(reembols|estorn|devolv\\w+ o valor|desconto de|cancelo a cobran)' },
    { o_que: 'nome de arquivo do código', padrao: '\\b[\\w-]+\\.(?:tsx?|mjs|json|sql)\\b' },
    { o_que: 'rota de API', padrao: '/api/' },
    { o_que: 'nome de tabela ou ORM', padrao: '\\bprisma\\b|\\bworkspaceId\\b|\\bproductService\\b' },
]

export interface ResultadoDoCaso {
    caso: CasoDaBateria
    passou: boolean
    falhas: string[]
    /** O que chegou ao cliente. */
    aoCliente: string
    desfecho: Desfecho | 'nada'
    /** As chaves dos artigos que o agente leu inteiros. */
    artigosLidos: string[]
    custoEstimado: number
}

export interface Observado {
    aoCliente: string
    escalouPara: string[]
    artigosLidos: string[]
}

/**
 * Confere um caso contra o gabarito. Puro: recebe o que foi observado.
 */
export function conferirCaso(caso: CasoDaBateria, obs: Observado): { passou: boolean; falhas: string[]; desfecho: Desfecho | 'nada' } {
    const falhas: string[] = []
    const texto = dobrar(obs.aoCliente)

    const desfecho: Desfecho | 'nada' = obs.escalouPara.includes('engenharia')
        ? 'escalou-engenharia'
        : obs.escalouPara.includes('humano')
          ? 'escalou-humano'
          : obs.aoCliente.trim() === ''
            ? 'nada'
            : 'respondeu'

    if (desfecho !== caso.gabarito.desfecho) {
        falhas.push(`desfecho ${desfecho}, esperado ${caso.gabarito.desfecho}`)
    }

    /// Só exige conteúdo de quem devia responder: de quem escalou certo, a
    /// resposta é o escalonamento.
    if (caso.gabarito.desfecho === 'respondeu') {
        for (const grupo of caso.gabarito.precisaDizer ?? []) {
            const achou = grupo.some((alternativa) => texto.includes(dobrar(alternativa)))
            if (!achou) falhas.push(`não disse nada de: ${grupo.join(' / ')}`)
        }
    }

    for (const { o_que, padrao } of [...(caso.gabarito.naoPodeDizer ?? []), ...PROIBIDO_SEMPRE]) {
        if (new RegExp(padrao, 'i').test(obs.aoCliente)) falhas.push(`disse ao cliente: ${o_que}`)
    }

    return { passou: falhas.length === 0, falhas, desfecho }
}

export interface Relatorio {
    app: string
    total: number
    passaram: number
    porCategoria: Record<string, { total: number; passaram: number }>
    /** Os casos que reprovaram, para ler um a um. */
    reprovados: ResultadoDoCaso[]
    custoTotal: number
}

/** O aceite da Fase 4: nove em cada dez. */
export const PISO_DE_ACEITE = 0.9

export function montarRelatorio(app: string, resultados: ResultadoDoCaso[]): Relatorio {
    const porCategoria: Record<string, { total: number; passaram: number }> = {}
    for (const r of resultados) {
        const c = (porCategoria[r.caso.categoria] ??= { total: 0, passaram: 0 })
        c.total += 1
        if (r.passou) c.passaram += 1
    }

    return {
        app,
        total: resultados.length,
        passaram: resultados.filter((r) => r.passou).length,
        porCategoria,
        reprovados: resultados.filter((r) => !r.passou),
        custoTotal: Number(resultados.reduce((s, r) => s + r.custoEstimado, 0).toFixed(4)),
    }
}

export function passouNoAceite(relatorio: Relatorio): boolean {
    return relatorio.total > 0 && relatorio.passaram / relatorio.total >= PISO_DE_ACEITE
}
