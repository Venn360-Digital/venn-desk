import { PrismaNeon } from '@prisma/adapter-neon'

import { PrismaClient } from '#prisma'

/**
 * O cliente do Prisma — **um por requisição**, criado e descartado no mesmo
 * ciclo.
 *
 * A razão vem medida do `venn-saas`, na produção Cloudflare: guardar um cliente
 * no isolate entre requisições deu 17 falhas em 20, porque o Workers não
 * garante que uma conexão aberta no contexto de uma requisição sirva na
 * seguinte, e o pool do Neon passa a entregar WebSocket morto. E o extremo
 * oposto — um cliente por acesso de propriedade — abre uma conexão por consulta
 * e produz 500 intermitente em qualquer tela que toque o banco.
 *
 * Aqui o meio-termo é mais simples que no app: o Hono já tem um contexto por
 * requisição, então o cliente nasce no middleware e é fechado no `finally`. Sem
 * `AsyncLocalStorage`, sem `Proxy`, sem global.
 *
 * **Fechar é obrigatório.** `PrismaNeon` abre um WebSocket por cliente, e o
 * runtime só encerra a invocação quando não há mais I/O pendente: sem
 * `$disconnect()` cada chamada segura uma conexão no Neon por cerca de dez
 * segundos. A documentação do driver é direta — em Workers o pool precisa ser
 * aberto, usado e fechado dentro do mesmo handler.
 */

/** Só o Neon: no Worker não existe outro destino (ADR 0008). */
export function criarCliente(databaseUrl: string): PrismaClient {
    if (!ehNeon(databaseUrl)) {
        throw new Error(
            'DATABASE_URL não aponta para o Neon, e este é o único driver que o Worker ' +
                'carrega. Confira o segredo DATABASE_URL.'
        )
    }

    return new PrismaClient({ adapter: new PrismaNeon({ connectionString: databaseUrl }) })
}

export function ehNeon(url: string): boolean {
    try {
        return new URL(url).hostname.endsWith('.neon.tech')
    } catch {
        return false
    }
}

/**
 * Fecha o cliente. **Não lança:** a resposta já saiu, e um erro aqui só
 * transformaria uma conexão vazada num 500 na tela.
 */
export async function descartarCliente(cliente: PrismaClient): Promise<void> {
    try {
        await cliente.$disconnect()
    } catch (erro) {
        console.error('[prisma] falha ao fechar o cliente da requisição:', erro)
    }
}
