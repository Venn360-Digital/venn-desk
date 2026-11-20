import { ErroDeExtracao } from '../tipos.ts'
import { PALAVRAS_DO_VOCABULARIO, type Genero, type Vocabulario } from '../tipos.ts'

/**
 * Lê o bloco `vocabulario: { … }` do `brand.ts` de um app.
 *
 * Determinístico, por regex: o bloco é um objeto literal de dezesseis strings
 * e um `genero` com quatro letras, sem template nem variável. Se um dia virar
 * código, isto lança `ErroDeExtracao` com a chave que faltou — e a
 * sincronização registra a falha em vez de publicar vocabulário errado em
 * cima de todos os artigos do app.
 */
export function extrairVocabulario(brandTs: string): Vocabulario {
    const inicio = brandTs.search(/\bvocabulario\s*:\s*\{/)
    if (inicio === -1) throw new ErroDeExtracao('vocabulario', 'não achei o bloco `vocabulario: {`')

    const bloco = blocoDeChaves(brandTs, brandTs.indexOf('{', inicio))

    /// O sub-bloco `genero: { pessoa: 'm', … }` repete as chaves dos eixos
    /// com uma letra como valor. Sai do texto antes de ler as palavras, senão
    /// `pessoa` casaria com `'m'` antes de chegar em `'paciente'`.
    const generoAbre = bloco.search(/\bgenero\s*:\s*\{/)
    const generoBloco = generoAbre === -1 ? '' : blocoDeChaves(bloco, bloco.indexOf('{', generoAbre))
    const semGenero = generoBloco === '' ? bloco : bloco.replace(generoBloco, '')

    const palavras: Partial<Record<string, string>> = {}
    for (const chave of PALAVRAS_DO_VOCABULARIO) {
        const m = new RegExp(`\\b${chave}\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(semGenero)
        if (m === null) throw new ErroDeExtracao('vocabulario', `faltou a chave \`${chave}\``)
        palavras[chave] = desescapar(m[1] ?? '')
    }

    const genero: Record<string, Genero> = {}
    for (const eixo of ['organizacao', 'pessoa', 'profissional', 'servico']) {
        const m = new RegExp(`\\b${eixo}\\s*:\\s*'([mf])'`).exec(generoBloco)
        if (m === null) throw new ErroDeExtracao('vocabulario', `faltou o gênero de \`${eixo}\``)
        genero[eixo] = m[1] as Genero
    }

    return {
        genero: genero as Vocabulario['genero'],
        ...(palavras as Record<(typeof PALAVRAS_DO_VOCABULARIO)[number], string>),
    }
}

/** O texto entre a chave aberta em `abre` e a que a fecha, contando aninhadas. */
export function blocoDeChaves(texto: string, abre: number): string {
    let nivel = 0
    for (let i = abre; i < texto.length; i++) {
        const c = texto[i]
        if (c === "'" || c === '"' || c === '`') {
            i = fimDaString(texto, i)
            continue
        }
        if (c === '{') nivel++
        if (c === '}') {
            nivel--
            if (nivel === 0) return texto.slice(abre, i + 1)
        }
    }
    return texto.slice(abre)
}

/** Índice da aspa que fecha a string aberta em `abre`, respeitando `\`. */
export function fimDaString(texto: string, abre: number): number {
    const aspa = texto[abre]
    for (let i = abre + 1; i < texto.length; i++) {
        if (texto[i] === '\\') {
            i++
            continue
        }
        if (texto[i] === aspa) return i
    }
    return texto.length
}

export function desescapar(s: string): string {
    return s.replace(/\\(['"\\])/g, '$1')
}
