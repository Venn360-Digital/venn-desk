import type { Agent, PrismaClient } from '#prisma'

/**
 * A equipe interna. Como `apps.ts`, não é escopado por app — e aqui por outro
 * motivo: a mesma pessoa atende vários apps, então `agents` não tem `app_id`.
 *
 * Mora em `src/dados/` para a regra do `scripts/lint-isolamento.mjs` continuar
 * valendo sem exceção: nenhum arquivo fora desta pasta toca uma tabela.
 */
export async function agentePorEmail(
    cliente: PrismaClient,
    email: string
): Promise<Agent | null> {
    return cliente.agent.findFirst({ where: { email, ativo: true } })
}

export async function agentePorSlackId(
    cliente: PrismaClient,
    slackId: string
): Promise<Agent | null> {
    return cliente.agent.findFirst({ where: { slackId, ativo: true } })
}
