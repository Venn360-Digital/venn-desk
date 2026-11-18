/**
 * A busca por chamados parecidos — a que o agente usa antes de responder.
 *
 * **Por que ela precisou existir.** A primeira versão casava substring no
 * assunto, e isso falha no caso mais comum do suporte: duas pessoas descrevem o
 * mesmo problema com palavras diferentes. "A agenda não abre depois do login" e
 * "recepcionista nova não consegue ver a agenda" são o mesmo assunto e não têm
 * substring em comum. O resultado medido em 18/11/2026 foi o agente buscando
 * CINCO vezes no mesmo chamado, trocando termos, sem achar nada — o maior
 * desperdício de tokens que sobrou no atendimento.
 *
 * A correção é casar por PALAVRA, com acento dobrado e palavra vazia
 * descartada, e ordenar pelo quanto casou. Uma busca passa a bastar.
 *
 * Módulo puro e sem banco: a comparação acontece sobre o que o escopo já
 * devolveu, e nunca monta cláusula com texto vindo do modelo.
 */

/**
 * Palavras que aparecem em quase todo chamado e não distinguem nada.
 *
 * Sem esta lista, buscar "não consigo ver a agenda" casaria com todo chamado
 * que contém "não" — ou seja, com todos — e a ordenação viraria ruído.
 */
const VAZIAS = new Set([
    'a', 'as', 'o', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
    'nos', 'nas', 'por', 'para', 'com', 'sem', 'que', 'qual', 'quais', 'como', 'e', 'ou',
    'nao', 'sim', 'eu', 'ele', 'ela', 'meu', 'minha', 'se', 'ao', 'aos', 'mais', 'muito',
    'ja', 'mas', 'tem', 'ter', 'esta', 'esse', 'essa', 'isso', 'pelo', 'pela', 'quando',
])

/** Mínimo de letras para uma palavra valer como termo. */
const TAMANHO_MINIMO = 3

/**
 * Dobra acento e caixa.
 *
 * `NFD` separa a letra do acento e o `replace` remove a marca — assim "não",
 * "nao" e "NÃO" viram a mesma coisa. Sem isto, metade dos chamados escritos
 * com pressa não casaria com os escritos com calma.
 */
export function dobrar(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
}

export function termosDe(texto: string): string[] {
    const palavras = dobrar(texto)
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length >= TAMANHO_MINIMO && !VAZIAS.has(p))

    return [...new Set(palavras)]
}

/**
 * Quantas letras iniciais duas palavras têm em comum.
 *
 * Prefixo puro (`startsWith`) não basta, e o teste mostrou por quê: "bloquear"
 * e "bloqueio" são a mesma ideia e **nenhuma é prefixo da outra** — elas
 * divergem na sexta letra. O mesmo vale para "configurar"/"configuração" e
 * qualquer par que mude de sufixo. O que elas compartilham é o começo, e é o
 * começo que precisa ser medido.
 */
function prefixoComum(a: string, b: string): number {
    const limite = Math.min(a.length, b.length)
    let i = 0
    while (i < limite && a[i] === b[i]) i += 1
    return i
}

/**
 * Letras em comum para duas palavras diferentes contarem como a mesma.
 *
 * Cinco: "bloquear"/"bloqueio" compartilham seis e casam; "configurar"/
 * "confirmar" compartilham quatro e não casam, que é o resultado certo. Abaixo
 * disso a busca começa a juntar assunto que não tem nada a ver.
 */
const PREFIXO_MINIMO = 5

/**
 * Quanto um texto casa com os termos procurados, de 0 a 1.
 *
 * É a fração dos termos encontrados, e não a contagem: assim uma busca de duas
 * palavras e uma de seis são comparáveis, e o limiar vale para as duas.
 *
 * Plural e flexão são a diferença mais comum entre duas pessoas descrevendo o
 * mesmo problema, e exigir igualdade exata perderia justamente esses casos.
 */
export function pontuar(texto: string, termos: string[]): number {
    if (termos.length === 0) return 0

    const alvo = termosDe(texto)
    const casados = termos.filter((termo) =>
        alvo.some(
            (palavra) =>
                palavra.startsWith(termo) ||
                termo.startsWith(palavra) ||
                prefixoComum(palavra, termo) >= PREFIXO_MINIMO
        )
    )

    return casados.length / termos.length
}

/**
 * Metade dos termos. Abaixo disso, o resultado atrapalha mais do que ajuda —
 * um chamado que casa só "agenda" numa busca de quatro palavras não é parecido,
 * é do mesmo módulo.
 */
export const LIMIAR = 0.5

export interface Candidato {
    assunto: string
}

/** Ordena do mais parecido ao menos, descartando o que não alcança o limiar. */
export function parecidos<T extends Candidato>(
    candidatos: T[],
    busca: string,
    limite: number
): { item: T; nota: number }[] {
    const termos = termosDe(busca)

    return candidatos
        .map((item) => ({ item, nota: pontuar(item.assunto, termos) }))
        .filter(({ nota }) => nota >= LIMIAR)
        .sort((a, b) => b.nota - a.nota)
        .slice(0, limite)
}
