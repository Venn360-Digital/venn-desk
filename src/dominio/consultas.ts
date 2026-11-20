import { termosDe } from './busca.ts'

/**
 * O que as consultas à base ensinam — dois indicadores da seção 12.
 *
 * **"Dúvidas sem artigo" vale mais que "artigos mais usados".** O segundo diz o
 * que manter; o primeiro diz o que ESCREVER. Com a base vazia e o produto
 * recém-chegado a clientes, a pergunta de quem vai redigir é "por onde
 * começo?" — e a resposta honesta não é um palpite meu, é a lista do que as
 * pessoas perguntaram e não acharam.
 *
 * As perguntas vazias são AGRUPADAS por parecença, não listadas uma a uma.
 * "não consigo exportar contatos", "exportar lista de contatos" e "como exporto
 * os contatos" são a mesma lacuna; três linhas separadas fariam a lacuna mais
 * comum parecer três raras.
 */

export interface ConsultaRegistrada {
    texto: string
    artigosDevolvidos: string[]
    artigoLidoId: string | null
    criadoEm: Date
}

export interface Lacuna {
    /** O texto da primeira ocorrência, como alguém escreveu. */
    exemplo: string
    vezes: number
    ultimaEm: Date
}

export interface ResumoDeConsultas {
    total: number
    semResposta: number
    /** Leituras inteiras por artigo. Só quem foi lido aparece. */
    leiturasPorArtigo: Record<string, number>
    lacunas: Lacuna[]
}

/**
 * Duas perguntas são a mesma lacuna quando compartilham metade dos termos.
 *
 * Reusa a mesma tokenização da busca (`termosDe`: acento e plural dobrados,
 * palavras vazias fora) — se a busca considera dois textos parecidos, o
 * agrupamento tem de considerar também, senão a lacuna que a busca não
 * resolveu aparece dividida aqui.
 */
const FRACAO_COMUM = 0.5

function mesmaLacuna(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return false
    const conjunto = new Set(a)
    const comuns = b.filter((t) => conjunto.has(t)).length
    return comuns / Math.min(a.length, b.length) >= FRACAO_COMUM
}

export function resumirConsultas(consultas: ConsultaRegistrada[]): ResumoDeConsultas {
    const leiturasPorArtigo: Record<string, number> = {}
    for (const c of consultas) {
        if (c.artigoLidoId !== null) {
            leiturasPorArtigo[c.artigoLidoId] = (leiturasPorArtigo[c.artigoLidoId] ?? 0) + 1
        }
    }

    const vazias = consultas.filter((c) => c.artigosDevolvidos.length === 0)

    /// Agrupamento guloso em ordem de chegada: a primeira pergunta de cada
    /// grupo vira o exemplo, porque é como alguém de fato escreveu — e é isso
    /// que quem vai redigir o artigo precisa ler, não uma média de palavras.
    const grupos: { termos: string[]; lacuna: Lacuna }[] = []
    for (const c of vazias) {
        const termos = termosDe(c.texto)
        const grupo = grupos.find((g) => mesmaLacuna(g.termos, termos))
        if (grupo === undefined) {
            grupos.push({ termos, lacuna: { exemplo: c.texto, vezes: 1, ultimaEm: c.criadoEm } })
        } else {
            grupo.lacuna.vezes += 1
            if (c.criadoEm > grupo.lacuna.ultimaEm) grupo.lacuna.ultimaEm = c.criadoEm
        }
    }

    return {
        total: consultas.length,
        semResposta: vazias.length,
        leiturasPorArtigo,
        lacunas: grupos.map((g) => g.lacuna).sort((a, b) => b.vezes - a.vezes),
    }
}
