import type { PrismaClient } from '#prisma'

/**
 * As poucas consultas de chamado que atravessam apps de propósito.
 *
 * Tudo o que é por app mora em `escopoDoApp`, e é lá que o isolamento é provado
 * rota por rota. O que vive aqui é o contrário: uma rodada do cron olha os três
 * produtos de uma vez, e o alerta que ela gera é da plataforma, não de um app.
 * Receber ids de apps diferentes é o propósito, então o `appId` não entra no
 * `where` — e por isso nada aqui devolve CONTEÚDO de chamado, só o que já é
 * público na trilha de alerta: o número e o prefixo.
 */
export async function numerosDosChamados(
    cliente: PrismaClient,
    ids: string[]
): Promise<Map<string, { numero: number; prefixo: string }>> {
    if (ids.length === 0) return new Map()

    const linhas = await cliente.ticket.findMany({
        where: { id: { in: ids } },
        select: { id: true, numero: true, app: { select: { prefixo: true } } },
    })

    return new Map(linhas.map((l) => [l.id, { numero: l.numero, prefixo: l.app.prefixo }]))
}
