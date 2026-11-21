import { divergencias, type AppComparavel } from '../conhecimento/divergencias.ts'
import { PALAVRAS_DO_VOCABULARIO, type Vocabulario } from '../conhecimento/tipos.ts'
import { dobrar } from '../dominio/busca.ts'
import type { CasoDaBateria } from './bateria.ts'

/**
 * O recorte da bateria para um app SECUNDÁRIO.
 *
 * Os três produtos são cascas sobre o mesmo `packages/core`. Medido em
 * 21/11/2026: 87 dos 100 casos de cada bateria são o mesmo caso com outro
 * vocabulário, 97% dos artigos de tela e todos os mapas técnicos são idênticos
 * entre apps depois de dobrar o vocabulário. Rodar os 100 nos três apps pagava
 * três vezes (US$ 27 cada) pela mesma prova.
 *
 * A bateria completa roda num app de REFERÊNCIA, porque é ela que mede o
 * agente, e o agente é o mesmo. Nos outros dois ficam só os casos que podem dar
 * resultado diferente:
 *
 * 1. **Artigo de origem que divergiu de fato** entre os apps (a FAQ triplicada
 *    à mão, os papéis, os planos, as regras de produto).
 * 2. **Caso cujo texto usa uma palavra do vocabulário**, porque é o vocabulário
 *    que muda a recuperação: "procedimento" e "serviço" não são a mesma palavra
 *    para a busca, e foi aí que Conecta e Stagent ficaram abaixo do piso.
 *
 * O que fica de fora não é "menos importante": é o que já foi medido no app de
 * referência, com o mesmo código e o mesmo texto.
 */

export interface LinhaDoBanco {
    slug: string
    /** O nome do produto, para dobrar junto com o vocabulário. */
    nome?: string
    chave: string
    titulo: string
    corpo: string
    /** O resultado da última sincronização concluída do app, com o vocabulário. */
    resultado: unknown
}

export interface Recorte {
    vale(caso: CasoDaBateria): boolean
    /** Em uma linha, por que estes casos e não os outros. */
    porque: string
}

export function chavesDoRecorte(linhas: LinhaDoBanco[], app: string): Recorte {
    const porApp = new Map<string, AppComparavel>()
    for (const l of linhas) {
        const vocabulario = vocabularioDoResultado(l.resultado)
        if (vocabulario === null) continue
        const atual = porApp.get(l.slug) ?? { slug: l.slug, nome: l.nome ?? l.slug, vocabulario, artigos: [] }
        atual.artigos.push({ chave: l.chave, titulo: l.titulo, corpo: l.corpo })
        porApp.set(l.slug, atual)
    }

    const comparaveis = [...porApp.values()]
    const divergentes = new Set(divergencias(comparaveis).map((d) => d.chave))
    const vocabulario = porApp.get(app)?.vocabulario ?? null
    const termos = vocabulario === null ? [] : [...new Set(PALAVRAS_DO_VOCABULARIO.map((k) => dobrar(vocabulario[k])))]

    /**
     * Sem material para comparar, NÃO recorta.
     *
     * Acontece de verdade: app sem sincronização concluída desde que o
     * vocabulário passou a ser gravado no resultado. Recortar aí devolveria
     * zero caso e a rodada "passaria" sem medir nada — o pior desfecho
     * possível para um aceite.
     */
    if (comparaveis.length < 2 || vocabulario === null) {
        return { vale: () => true, porque: 'sem vocabulário dos dois lados para comparar: a bateria roda inteira' }
    }

    return {
        vale(caso) {
            const chave = caso.gabarito.artigoEsperado
            if (chave !== undefined && divergentes.has(chave)) return true
            const texto = dobrar(`${caso.assunto} ${caso.mensagem}`)
            return termos.some((t) => new RegExp(`(?<![\\p{L}\\p{N}])${t}(?![\\p{L}\\p{N}])`, 'u').test(texto))
        },
        porque: `${divergentes.size} chave(s) divergentes entre ${comparaveis.length} apps, mais os casos que usam o vocabulário do ${app}`,
    }
}

function vocabularioDoResultado(resultado: unknown): Vocabulario | null {
    if (typeof resultado !== 'object' || resultado === null) return null
    const voc = (resultado as { vocabulario?: unknown }).vocabulario
    if (typeof voc !== 'object' || voc === null) return null
    /// Uma das dezesseis formas basta para saber que é o objeto certo.
    return 'Pessoas' in voc ? (voc as Vocabulario) : null
}
