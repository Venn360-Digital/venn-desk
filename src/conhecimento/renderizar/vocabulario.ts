import { dobrar } from '../../dominio/busca.ts'
import { PALAVRAS_DO_VOCABULARIO, type Vocabulario } from '../tipos.ts'

/**
 * Trocar placeholders e palavras de um nicho pelas do outro.
 *
 * Dois usos. O primeiro é resolver `{{Pessoas}}` → "Pacientes" num texto que o
 * extrator deixou neutro de propósito (o core é compartilhado: extrai 1×,
 * renderiza 3×). O segundo é traduzir um texto escrito para um app (o
 * `PRODUCT.md` fala em clínica) para o vocabulário de outro — com fronteira de
 * palavra, para "clínica" não virar "empresa" dentro de "clínicas".
 */

const PLACEHOLDER = /\{\{([a-zA-Z]+)\}\}/g

export function resolverPlaceholders(texto: string, v: Vocabulario): string {
    return texto.replace(PLACEHOLDER, (tudo, chave: string) =>
        (PALAVRAS_DO_VOCABULARIO as string[]).includes(chave) ? v[chave as keyof Vocabulario & string] as string : tudo
    )
}

/**
 * Traduz as palavras de um vocabulário para outro, por fronteira de palavra.
 *
 * Plural antes de singular e maiúscula antes de minúscula, para "Pacientes"
 * casar inteiro antes de "paciente" roer o começo dele.
 */
export function substituirVocabulario(texto: string, de: Vocabulario, para: Vocabulario): string {
    const pares = PALAVRAS_DO_VOCABULARIO.map((k) => [de[k], para[k]] as const)
        .filter(([a, b]) => a !== b)
        .sort((x, y) => y[0].length - x[0].length)

    let saida = texto
    for (const [a, b] of pares) {
        saida = saida.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapar(a)}(?![\\p{L}\\p{N}])`, 'gu'), b)
    }
    return saida
}

/**
 * As palavras de OUTROS nichos que aparecem num texto deste.
 *
 * É o detector da FAQ triplicada: "clínica" e "paciente" dentro do app de
 * intercâmbio. Devolve as palavras achadas, dobradas, para o relatório de
 * divergências listar.
 */
export function palavrasEstranhas(texto: string, deste: Vocabulario, outros: Vocabulario[]): string[] {
    const minhas = new Set(PALAVRAS_DO_VOCABULARIO.map((k) => dobrar(deste[k])))
    const dobrado = dobrar(texto)
    const achadas = new Set<string>()

    for (const outro of outros) {
        for (const k of PALAVRAS_DO_VOCABULARIO) {
            const palavra = dobrar(outro[k])
            if (minhas.has(palavra)) continue
            if (new RegExp(`(?<![\\p{L}\\p{N}])${escapar(palavra)}(?![\\p{L}\\p{N}])`, 'u').test(dobrado)) {
                achadas.add(palavra)
            }
        }
    }

    return [...achadas].sort()
}

function escapar(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
