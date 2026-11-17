/**
 * O portão de CI — o mesmo papel do `scripts/ci-worker.mjs` dos apps.
 *
 * Roda no build do Workers Builds, antes de publicar, e é o check obrigatório do
 * PR (ADR 0007: não há GitHub Actions). Falha aqui reprova o check e a proteção
 * de branch barra o merge.
 *
 * Rodar o portão localmente antes do push é o que economiza minutos de build —
 * cada push da IA dispara um build inteiro.
 */
import { spawnSync } from 'node:child_process'

const ETAPAS = [
    ['Tipos', 'pnpm', ['run', 'typecheck']],
    ['Isolamento', 'node', ['scripts/lint-isolamento.mjs']],
    ['Rotas', 'node', ['scripts/lint-rotas.mjs']],
    ['Provas', 'pnpm', ['run', 'test']],
]

let falhou = false

for (const [nome, comando, argumentos] of ETAPAS) {
    process.stdout.write(`\n── ${nome} ──\n`)
    const { status } = spawnSync(comando, argumentos, { stdio: 'inherit' })

    if (status !== 0) {
        falhou = true
        process.stdout.write(`\n✗ ${nome} reprovou\n`)
        // Segue para as etapas seguintes de propósito: um PR deve voltar com
        // tudo o que está errado, não com o primeiro erro.
    }
}

if (falhou) {
    process.stdout.write('\nO portão reprovou. Nada é publicado.\n')
    process.exit(1)
}

process.stdout.write('\n✓ Portão aprovado.\n')
