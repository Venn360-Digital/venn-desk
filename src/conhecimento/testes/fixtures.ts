import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/**
 * Lê uma fixture real copiada do venn-saas (somente leitura, `git show`).
 *
 * As fixtures são conteúdo de produto — FAQ, menu, planos, vocabulário — sem
 * dado pessoal. Copiadas em 19/11/2026 de `origin/main` (a097f27).
 */
export function fixture(nome: string): string {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${nome}`, import.meta.url)), 'utf8')
}
