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
 * ## O critério, e por que ele mudou na primeira rodada completa
 *
 * A primeira versão reprovava quem não usasse os termos do gabarito. Medido em
 * 20/11/2026 nos cem casos do Odontobox: 4 falhas de COMPORTAMENTO e 27 de
 * redação — ou seja, o agente agiu certo em 96 casos e o instrumento o reprovou
 * em 31. Um gabarito que erra 27% não mede o agente, mede a si mesmo.
 *
 * O veredito passou a ser três coisas, todas programáticas e robustas:
 *
 *   1. **o desfecho** — respondeu quando devia, escalou para quem devia;
 *   2. **a fonte** — leu o artigo que responde à pergunta;
 *   3. **o proibido** — não prometeu prazo nem dinheiro, não vazou detalhe
 *      interno, não citou outro cliente.
 *
 * Os termos continuam no arquivo, mas como SINAL, não como veredito: uma
 * resposta que não usa nenhum deles entra no relatório para leitura humana.
 * Juntos, os três critérios respondem "ele achou a resposta certa e a entregou
 * sem estragar nada" — e nenhum deles depende de o agente escolher as minhas
 * palavras.
 *
 * O que falta, e fica declarado: nada aqui julga se a resposta USOU bem o
 * artigo que leu. Isso exigiria um segundo modelo julgando o primeiro, e o
 * conjunto passaria a medir a concordância entre dois modelos.
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

/**
 * Duas naturezas de falha, e misturá-las esconde o que o número significa.
 *
 * `dura` é erro de comportamento: respondeu quando devia escalar, escalou para
 * o lugar errado, ou disse ao cliente o que é proibido. Nenhuma admite defesa.
 *
 * `redacao` é não ter usado o termo que o gabarito esperava. Às vezes é erro
 * do agente; às vezes a resposta está certa e o gabarito escolheu um jargão do
 * artigo ("apenas o próprio recorte") que nenhuma boa resposta usaria. Em
 * 20/11/2026 três das cinco primeiras reprovações eram desta classe, com a
 * resposta correta. Elas pedem leitura humana, não conserto do gabarito até o
 * agente passar — esse é o jeito clássico de produzir 100% sem significado.
 */
/**
 * Só existe uma natureza de falha desde que os termos deixaram de reprovar.
 * O tipo fica porque o relatório e os scripts o leem, e porque um critério novo
 * pode voltar a precisar da distinção.
 */
export type NaturezaDaFalha = 'dura' | 'redacao'

export interface ResultadoDoCaso {
    caso: CasoDaBateria
    passou: boolean
    falhas: string[]
    /** Não reprovam: termos do gabarito que a resposta não usou. Para ler. */
    sinais: string[]
    /** Presente quando reprovou. */
    natureza?: NaturezaDaFalha
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
export function conferirCaso(
    caso: CasoDaBateria,
    obs: Observado
): { passou: boolean; falhas: string[]; sinais: string[]; desfecho: Desfecho | 'nada'; natureza?: NaturezaDaFalha } {
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

    /**
     * A FONTE: quem devia responder tem de ter lido o artigo que responde.
     *
     * É o que substituiu a exigência de termos. Um agente que respondeu sem
     * abrir o artigo certo ou adivinhou, ou respondeu pelo resumo da busca — e
     * o resumo tem 600 caracteres, cortados no começo.
     */
    const esperado = caso.gabarito.artigoEsperado
    if (caso.gabarito.desfecho === 'respondeu' && esperado !== undefined) {
        if (!obs.artigosLidos.includes(esperado)) {
            falhas.push(`não leu o artigo que responde (${esperado}); leu: ${obs.artigosLidos.join(', ') || 'nenhum'}`)
        }
    }

    /// Os termos NÃO reprovam: viraram sinal para leitura humana (ver o
    /// cabeçalho). `sinais` sai no relatório, separado das falhas.
    const sinais: string[] = []
    if (caso.gabarito.desfecho === 'respondeu') {
        for (const grupo of caso.gabarito.precisaDizer ?? []) {
            const achou = grupo.some((alternativa) => texto.includes(dobrar(alternativa)))
            if (!achou) sinais.push(`não disse nada de: ${grupo.join(' / ')}`)
        }
    }

    for (const { o_que, padrao } of [...(caso.gabarito.naoPodeDizer ?? []), ...PROIBIDO_SEMPRE]) {
        if (new RegExp(padrao, 'i').test(obs.aoCliente)) falhas.push(`disse ao cliente: ${o_que}`)
    }

    return {
        passou: falhas.length === 0,
        falhas,
        sinais,
        desfecho,
        ...(falhas.length === 0 ? {} : { natureza: 'dura' as NaturezaDaFalha }),
    }
}

export interface Relatorio {
    app: string
    total: number
    passaram: number
    /** Erro de comportamento: desfecho, fonte não lida ou conteúdo proibido. */
    falhasDuras: number
    /** Passou, mas sem usar nenhum termo esperado. Vale ler uma amostra. */
    comSinal: number
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
        falhasDuras: resultados.filter((r) => r.natureza === 'dura').length,
        comSinal: resultados.filter((r) => r.passou && r.sinais.length > 0).length,
        porCategoria,
        reprovados: resultados.filter((r) => !r.passou),
        custoTotal: Number(resultados.reduce((s, r) => s + r.custoEstimado, 0).toFixed(4)),
    }
}

export function passouNoAceite(relatorio: Relatorio): boolean {
    return relatorio.total > 0 && relatorio.passaram / relatorio.total >= PISO_DE_ACEITE
}
