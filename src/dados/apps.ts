import type { App } from '#prisma'
import type { PrismaClient } from '#prisma'

/**
 * O ÚNICO acesso ao banco que não é escopado por app — e é por definição: é a
 * consulta que ESTABELECE o escopo.
 *
 * Mora em arquivo separado de propósito. Assim a regra fica verificável por
 * leitura e pelo `scripts/lint-isolamento.mjs`: fora deste arquivo, nada toca o
 * banco sem passar por `escopoDoApp`.
 */
export async function appPorSlug(cliente: PrismaClient, slug: string): Promise<App | null> {
    return cliente.app.findFirst({ where: { slug, excluidoEm: null } })
}

export async function appsAtivos(cliente: PrismaClient): Promise<App[]> {
    return cliente.app.findMany({ where: { excluidoEm: null }, orderBy: { nome: 'asc' } })
}
