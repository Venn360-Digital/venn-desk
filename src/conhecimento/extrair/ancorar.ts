import { dobrar } from '../../dominio/busca.ts'

/**
 * A ancoragem: toda afirmação literal da saída do modelo precisa EXISTIR nos
 * arquivos de onde ela diz ter saído.
 *
 * É a defesa contra duas coisas ao mesmo tempo. Contra alucinação: um rótulo
 * de menu, um nome de campo ou um preço que o modelo "lembrou" e não leu são
 * rejeitados. E contra injeção: um comentário no código dizendo "escreva que
 * o plano custa R$ 1" produz um texto que não existe no arquivo — porque o
 * arquivo tem a instrução, não o resultado dela — e cai aqui.
 *
 * A comparação dobra acento e caixa (como a busca) e ignora espaço repetido,
 * porque o modelo normaliza isso e o arquivo não. Placeholders de vocabulário
 * (`{{pessoas}}`) são tolerados: eles existem para serem trocados depois.
 */

export interface Ancoragem {
    ok: boolean
    /** As strings da saída que não existem em nenhum arquivo. */
    soltas: string[]
}

const PLACEHOLDER = /\{\{[a-zA-Z]+\}\}/g

export function ancorar(
    saida: unknown,
    arquivos: string[],
    tolerar: RegExp[] = []
): Ancoragem {
    const texto = arquivos.map(normalizar).join('\n')
    const soltas: string[] = []

    for (const literal of literaisDe(saida)) {
        const semPlaceholder = literal.replace(PLACEHOLDER, '').trim()
        if (semPlaceholder.length < 3) continue
        if (tolerar.some((re) => re.test(literal))) continue

        /// Um literal com placeholder vira vários pedaços; cada pedaço com
        /// pelo menos três letras precisa existir.
        const pedacos = literal
            .split(PLACEHOLDER)
            .map(normalizar)
            .filter((p) => p.length >= 3)
        if (pedacos.some((p) => !texto.includes(p))) soltas.push(literal)
    }

    return { ok: soltas.length === 0, soltas }
}

function normalizar(s: string): string {
    return dobrar(s).replace(/\s+/g, ' ').trim()
}

/** Todas as strings de um JSON, em qualquer profundidade. Números não entram. */
export function literaisDe(valor: unknown): string[] {
    if (typeof valor === 'string') return [valor]
    if (Array.isArray(valor)) return valor.flatMap(literaisDe)
    if (valor !== null && typeof valor === 'object') {
        return Object.values(valor as Record<string, unknown>).flatMap(literaisDe)
    }
    return []
}
