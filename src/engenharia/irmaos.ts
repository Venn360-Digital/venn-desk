import type { PrismaClient } from '#prisma'

import { appsSincronizaveis } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'

/**
 * A rotina dos apps IRMÃOS (Fase 6).
 *
 * Os três produtos são cascas sobre o mesmo `packages/core`. Um defeito num
 * arquivo do core não é "o defeito do Odontobox": é o defeito dos três, e os
 * outros dois só não têm chamado ainda porque ninguém tropeçou nele.
 *
 * **O que esta rotina faz:** registra o defeito espelho nos irmãos, com nota
 * dizendo de onde veio. É visibilidade, não ação — quem decide corrigir e quando
 * é gente, e o defeito espelho nasce na etapa inicial como qualquer outro.
 *
 * **O que ela NÃO faz:** abrir chamado em nome de cliente nenhum. Chamado é algo
 * que uma pessoa relata; criar um "em nome de todos" encheria a fila de trabalho
 * que ninguém pediu e estragaria todo indicador de volume.
 *
 * **Por que o caminho decide.** Arquivo em `apps/<app>/` é daquele app e não
 * afeta ninguém; em `packages/core/` afeta todos. É a única informação
 * necessária, e ela já está no diagnóstico do N2.
 */

/** O prefixo que torna um arquivo compartilhado. */
export const PREFIXO_COMPARTILHADO = 'packages/core/'

export function tocaOCompartilhado(caminhos: string[]): boolean {
    return caminhos.some((c) => c.startsWith(PREFIXO_COMPARTILHADO))
}

export interface Espelho {
    app: string
    problemaId: string
    criado: boolean
}

export async function espelharNosIrmaos(p: {
    cliente: PrismaClient
    /** O app onde o defeito foi encontrado. */
    appDeOrigem: { id: string; slug: string; repositorio: string | null }
    /** `ODB-1042`, para a nota dizer de onde veio. */
    numeroDeOrigem: string
    titulo: string
    caminhos: string[]
}): Promise<Espelho[]> {
    if (!tocaOCompartilhado(p.caminhos)) return []
    if (p.appDeOrigem.repositorio === null) return []

    const todos = await appsSincronizaveis(p.cliente)
    const irmaos = todos.filter((a) => a.repositorio === p.appDeOrigem.repositorio && a.id !== p.appDeOrigem.id)

    const espelhos: Espelho[] = []

    for (const irmao of irmaos) {
        const escopo = escopoDoApp(p.cliente, irmao.id)

        try {
            /**
             * Um espelho por defeito de origem, e a chave é o TÍTULO.
             *
             * `problems` não tem coluna de origem, e acrescentá-la obrigaria
             * migração para guardar o que o título já diz. O preço é que dois
             * defeitos com o mesmo título no irmão não ganham segundo espelho —
             * o que é o comportamento desejado.
             */
            const titulo = `${p.titulo} (mesmo defeito de ${p.numeroDeOrigem})`
            const existentes = await escopo.problemas.porTitulo(titulo)

            if (existentes !== null) {
                espelhos.push({ app: irmao.slug, problemaId: existentes.id, criado: false })
                continue
            }

            const problema = await escopo.problemas.abrir({
                titulo,
                causa:
                    `Encontrado em ${p.numeroDeOrigem} (${p.appDeOrigem.slug}). ` +
                    `Toca ${PREFIXO_COMPARTILHADO}, que os três produtos compartilham, ` +
                    `então este app tem o mesmo defeito — ainda sem chamado.`,
            })

            espelhos.push({ app: irmao.slug, problemaId: problema.id, criado: true })
        } catch (erro) {
            /// Um irmão não derruba o outro: o espelho é visibilidade, e perder
            /// um aviso é melhor que perder o diagnóstico que o gerou.
            console.error(`[irmaos] não espelhei em ${irmao.slug}:`, erro)
        }
    }

    return espelhos
}
