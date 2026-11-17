/**
 * Publica a página de status no GitHub Pages.
 *
 * **Por que o build acontece aqui e não no GitHub.** O projeto não usa GitHub
 * Actions (ADR 0007), e o Pages servindo de uma branch não roda build nenhum:
 * ele serve os arquivos como estão. Então esta máquina gera o HTML e empurra o
 * resultado pronto para `gh-pages`. O Pages vira hospedagem estática burra, que
 * é exatamente o que a seção 7 pede — quanto menos esse caminho depende de
 * máquina ligada, mais ele serve para o dia em que tudo mais caiu.
 *
 * **Por que uma branch separada e não `docs/` na main.** `main` exige PR por
 * ruleset, e artefato de build não deve passar por revisão de código. A
 * `gh-pages` carrega só o resultado, e a fonte continua na `main`, privada.
 *
 * Uso: node scripts/publicar-status.mjs [--só-montar]
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { montar } from '../status/montar.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const BRANCH = 'gh-pages'

/// `stdio: 'ignore'` faz o `execFileSync` devolver `null`, não string — daí o
/// `?? ''`. Sem ele, toda chamada silenciosa quebrava num `.trim()` de null.
const git = (args, opcoes = {}) =>
    (execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', ...opcoes }) ?? '').trim()

const arquivos = montar()
process.stdout.write(`✓ ${arquivos.length} arquivos gerados\n`)

if (process.argv.includes('--só-montar')) process.exit(0)

/// Uma worktree descartável: a árvore de trabalho do dev não é tocada, e um
/// erro no meio não deixa o repositório numa branch estranha.
const arvore = mkdtempSync(join(tmpdir(), 'gh-pages-'))
let existe = false
try {
    git(['fetch', 'origin', BRANCH], { stdio: 'ignore' })
    existe = true
} catch {
    process.stdout.write(`  ${BRANCH} ainda não existe no remoto — criando órfã\n`)
}

try {
    if (existe) {
        git(['worktree', 'add', '-B', BRANCH, arvore, `origin/${BRANCH}`], { stdio: 'ignore' })
    } else {
        git(['worktree', 'add', '--detach', arvore], { stdio: 'ignore' })
        execFileSync('git', ['checkout', '--orphan', BRANCH], { cwd: arvore, stdio: 'ignore' })
    }

    /// Esvazia o índice, não a pasta: o que sobra de uma publicação anterior
    /// tem de sair, ou uma página removida continuaria no ar.
    execFileSync('git', ['rm', '-rq', '--ignore-unmatch', '--cached', '.'], {
        cwd: arvore,
        stdio: 'ignore',
    })
    for (const entrada of execFileSync('ls', ['-A'], { cwd: arvore, encoding: 'utf8' }).split('\n')) {
        if (entrada !== '' && entrada !== '.git') rmSync(join(arvore, entrada), { recursive: true, force: true })
    }

    cpSync(join(RAIZ, 'status', 'dist'), arvore, { recursive: true })

    execFileSync('git', ['add', '-A'], { cwd: arvore, stdio: 'inherit' })
    const mudou = execFileSync('git', ['status', '--porcelain'], { cwd: arvore, encoding: 'utf8' })

    if (mudou.trim() === '') {
        process.stdout.write('  nada mudou desde a última publicação\n')
    } else {
        execFileSync(
            'git',
            ['commit', '-q', '-m', `status: página gerada em ${new Date().toISOString()}`],
            { cwd: arvore, stdio: 'inherit' }
        )
        execFileSync('git', ['push', '-q', 'origin', BRANCH], { cwd: arvore, stdio: 'inherit' })
        process.stdout.write(`✓ publicado em ${BRANCH}\n`)
    }
} finally {
    try {
        git(['worktree', 'remove', '--force', arvore], { stdio: 'ignore' })
    } catch {
        rmSync(arvore, { recursive: true, force: true })
    }
}
