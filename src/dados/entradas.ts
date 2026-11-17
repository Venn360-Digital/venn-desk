import type { PrismaClient } from '#prisma'

/**
 * A trava de idempotência da seção 6.
 *
 * O Events API do Slack **reentrega**: qualquer resposta que não chegue em 3
 * segundos vira uma nova tentativa, com o mesmo `event_id`. Sem esta tabela,
 * uma lentidão do banco viraria mensagem duplicada na thread do cliente.
 *
 * Como `apps.ts` e `agentes.ts`, não é escopado por app — e pelo mesmo motivo:
 * o evento chega antes de se saber de que app ele é. Mora em `src/dados/` para
 * a regra do `scripts/lint-isolamento.mjs` continuar valendo sem exceção.
 */
export async function registrarEntrada(
    cliente: PrismaClient,
    origem: string,
    externalId: string
): Promise<boolean> {
    try {
        await cliente.inboundEvent.create({ data: { origem, externalId } })
        return true
    } catch {
        /**
         * A colisão do índice único é a resposta certa, e não um erro: quem
         * perde a corrida é a reentrega. Decidir por `findFirst` antes do
         * `create` deixaria uma janela entre a consulta e a escrita — e duas
         * reentregas simultâneas passariam as duas.
         */
        return false
    }
}
