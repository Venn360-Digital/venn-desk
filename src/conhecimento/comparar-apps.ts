import type { PrismaClient } from '#prisma'

import { appsSincronizaveis } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { divergencias, type AppComparavel, type Divergencia } from './divergencias.ts'
import type { ResultadoDaSincronizacao } from './sincronizar.ts'
import type { Vocabulario } from './tipos.ts'

/**
 * Monta a comparação entre apps a partir do que já está no banco.
 *
 * O vocabulário vem do resultado da última sincronização CONCLUÍDA, porque é
 * com ele que os artigos daquela rodada foram renderizados. App sem rodada
 * concluída fica fora: comparar o texto dele seria comparar com um vocabulário
 * adivinhado.
 *
 * A referência é o app mais ANTIGO, e não é detalhe: é dele que o texto dos
 * outros foi copiado quando alguém triplicou a FAQ à mão, então é contra ele
 * que a cópia faz sentido ser lida.
 */
export async function appsComparaveis(
    cliente: PrismaClient,
    /**
     * De onde tirar o vocabulário quando o banco não o tem.
     *
     * O vocabulário passou a ser gravado no resultado da sincronização em
     * 21/11/2026, então as rodadas anteriores a isso não o carregam. O script
     * de linha de comando injeta uma leitura do repositório (grátis, é o
     * GitHub); a rota do Console não injeta nada, porque uma tela interna não
     * deve depender de um serviço de fora para abrir.
     */
    deFora?: (app: { slug: string; repositorio: string; pastaNoRepositorio: string }) => Promise<Vocabulario | null>
): Promise<AppComparavel[]> {
    const apps = [...(await appsSincronizaveis(cliente))].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
    const comparaveis: AppComparavel[] = []

    for (const app of apps) {
        const escopo = escopoDoApp(cliente, app.id)
        const ultima = await escopo.sincronizacoes.ultimaConcluida()
        const doBanco = (ultima?.resultado as ResultadoDaSincronizacao | null)?.vocabulario
        const vocabulario =
            doBanco ??
            (deFora === undefined || app.repositorio === null || app.pastaNoRepositorio === null
                ? undefined
                : ((await deFora({ slug: app.slug, repositorio: app.repositorio, pastaNoRepositorio: app.pastaNoRepositorio })) ?? undefined))
        if (vocabulario === undefined) continue

        const artigos = await escopo.artigos.listar({ origem: 'DERIVADO', status: 'PUBLICADO' })
        comparaveis.push({
            slug: app.slug,
            nome: app.nome,
            vocabulario,
            artigos: artigos
                .filter((a): a is typeof a & { chave: string } => a.chave !== null)
                .map((a) => ({ chave: a.chave, titulo: a.titulo, corpo: a.corpo })),
        })
    }

    return comparaveis
}

export async function levantarDivergencias(
    cliente: PrismaClient,
    deFora?: Parameters<typeof appsComparaveis>[1]
): Promise<{ apps: string[]; achados: Divergencia[] }> {
    const comparaveis = await appsComparaveis(cliente, deFora)
    return { apps: comparaveis.map((a) => a.slug), achados: divergencias(comparaveis) }
}
