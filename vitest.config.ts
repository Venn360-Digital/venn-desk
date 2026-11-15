import { defineConfig } from 'vitest/config'

/**
 * Vitest em ambiente **Node**, de propósito.
 *
 * O pool de Workers (`@cloudflare/vitest-pool-workers`) instancia o Miniflare,
 * que exige macOS 13.5+ e não roda na máquina onde este projeto é escrito. Os
 * módulos testados aqui são puros por desenho — máquina de estados, prioridade,
 * numeração, validação de token — e não tocam binding nenhum.
 *
 * O que precisa de banco ou de binding é testado contra uma branch do Neon pelo
 * portão de CI, no Workers Builds.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
})
