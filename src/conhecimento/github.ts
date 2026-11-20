import { ErroDeDominio } from '../lib/erros.ts'

/**
 * O leitor do repositório do produto — só leitura, pela API REST do GitHub.
 *
 * **Por que uma interface e não chamadas soltas.** O sincronizador precisa ser
 * provado sem rede, e o GitHub precisa ser trocável: hoje é um token
 * fine-grained de leitura (`Contents: read` no `venn-saas`); na Fase 5 vira a
 * instalação do GitHub App do Desk, e nada acima desta interface muda.
 *
 * **Só leitura, por construção.** Não há método que escreva. A regra do
 * projeto — nenhuma ferramenta da IA faz merge, aprova ou publica — vale
 * também para o que o Desk faz sozinho.
 *
 * **Erros nomeados.** Quem consome decide o que repetir: limite de taxa espera
 * e tenta de novo; token inválido e fonte ausente não melhoram com repetição.
 */

export interface EntradaDaArvore {
    sha: string
    tamanho: number
}

export interface Commit {
    sha: string
    data: string
    assunto: string
    corpo: string
}

export interface ArquivoComparado {
    caminho: string
    status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
    caminhoAnterior?: string
}

export interface LeitorDoRepositorio {
    /** O sha do topo do ramo. Usa ETag: 304 não conta no limite de taxa. */
    shaDoRamo(repositorio: string, ramo: string): Promise<string>
    /** Todos os blobs do commit, por caminho. Lança se o GitHub truncar. */
    arvore(repositorio: string, commitSha: string): Promise<Map<string, EntradaDaArvore>>
    /** O conteúdo de um blob, decodificado como UTF-8. */
    blob(repositorio: string, blobSha: string): Promise<string>
    /** Commits de um ramo, opcionalmente só os que tocam um caminho. */
    commits(
        repositorio: string,
        filtro: { ref: string; caminho?: string; desde?: Date; limite: number }
    ): Promise<Commit[]>
    /** Os arquivos que mudaram entre dois commits. */
    comparar(repositorio: string, base: string, topo: string): Promise<ArquivoComparado[]>
}

export type CodigoDeLeitura = 'token_invalido' | 'limite_de_taxa' | 'fonte_ausente' | 'arvore_truncada' | 'resposta_invalida'

export class ErroDeLeitura extends ErroDeDominio {
    readonly codigoDeLeitura: CodigoDeLeitura

    constructor(codigo: CodigoDeLeitura, mensagem: string) {
        super(`github_${codigo}`, mensagem, 502)
        this.name = 'ErroDeLeitura'
        this.codigoDeLeitura = codigo
    }
}

const API = 'https://api.github.com'

/** Só o que usamos de `fetch`, para o teste injetar um falso. */
export type Buscador = (url: string, init: RequestInit) => Promise<Response>

export function leitorGitHub(token: string, buscar: Buscador = fetch): LeitorDoRepositorio {
    /// ETag por URL, em memória do isolate. Vale enquanto o isolate viver —
    /// o cron roda no mesmo isolate por minutos a horas, e é ele quem bate no
    /// ramo a cada cinco minutos. 304 não desconta do limite de 5.000/h.
    const etags = new Map<string, { etag: string; corpo: unknown }>()

    async function pedir<T>(caminho: string, opcoes: { comEtag?: boolean } = {}): Promise<T> {
        const url = `${API}${caminho}`
        const guardado = opcoes.comEtag === true ? etags.get(url) : undefined

        const resposta = await buscar(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'venn-desk',
                ...(guardado === undefined ? {} : { 'If-None-Match': guardado.etag }),
            },
        })

        if (resposta.status === 304 && guardado !== undefined) return guardado.corpo as T

        if (resposta.status === 401) {
            throw new ErroDeLeitura('token_invalido', 'O GitHub recusou o token de leitura.')
        }
        if (resposta.status === 429 || (resposta.status === 403 && resposta.headers.get('x-ratelimit-remaining') === '0')) {
            throw new ErroDeLeitura('limite_de_taxa', 'Limite de requisições do GitHub atingido.')
        }
        if (resposta.status === 403) {
            throw new ErroDeLeitura('token_invalido', 'O token não alcança este repositório.')
        }
        if (resposta.status === 404) {
            throw new ErroDeLeitura('fonte_ausente', `Não existe no GitHub: ${caminho}`)
        }
        if (!resposta.ok) {
            throw new ErroDeLeitura('resposta_invalida', `O GitHub respondeu ${resposta.status} em ${caminho}.`)
        }

        const corpo = (await resposta.json()) as T
        const etag = resposta.headers.get('etag')
        if (opcoes.comEtag === true && etag !== null) etags.set(url, { etag, corpo })

        return corpo
    }

    return {
        async shaDoRamo(repositorio, ramo) {
            const ref = await pedir<{ commit?: { sha?: string } }>(
                `/repos/${repositorio}/branches/${encodeURIComponent(ramo)}`,
                { comEtag: true }
            )
            const sha = ref.commit?.sha
            if (typeof sha !== 'string' || sha.length !== 40) {
                throw new ErroDeLeitura('resposta_invalida', 'O ramo veio sem sha.')
            }
            return sha
        },

        async arvore(repositorio, commitSha) {
            const corpo = await pedir<{
                truncated?: boolean
                tree?: { path: string; type: string; sha: string; size?: number }[]
            }>(`/repos/${repositorio}/git/trees/${commitSha}?recursive=1`)

            /// Truncada é falha alta, não lista parcial: sincronizar com metade
            /// dos arquivos arquivaria a outra metade como "fonte sumiu".
            if (corpo.truncated === true) {
                throw new ErroDeLeitura('arvore_truncada', 'O GitHub truncou a árvore do repositório.')
            }

            const mapa = new Map<string, EntradaDaArvore>()
            for (const entrada of corpo.tree ?? []) {
                if (entrada.type === 'blob') {
                    mapa.set(entrada.path, { sha: entrada.sha, tamanho: entrada.size ?? 0 })
                }
            }
            return mapa
        },

        async blob(repositorio, blobSha) {
            const corpo = await pedir<{ content?: string; encoding?: string }>(
                `/repos/${repositorio}/git/blobs/${blobSha}`
            )
            if (corpo.encoding !== 'base64' || typeof corpo.content !== 'string') {
                throw new ErroDeLeitura('resposta_invalida', 'O blob veio num formato inesperado.')
            }
            return decodificarBase64(corpo.content)
        },

        async commits(repositorio, filtro) {
            const parametros = new URLSearchParams({
                sha: filtro.ref,
                per_page: String(Math.min(filtro.limite, 100)),
            })
            if (filtro.caminho !== undefined) parametros.set('path', filtro.caminho)
            if (filtro.desde !== undefined) parametros.set('since', filtro.desde.toISOString())

            const lista = await pedir<
                { sha: string; commit: { message: string; committer?: { date?: string }; author?: { date?: string } } }[]
            >(`/repos/${repositorio}/commits?${parametros.toString()}`)

            return lista.map((c) => {
                const [assunto = '', ...resto] = c.commit.message.split('\n')
                return {
                    sha: c.sha,
                    data: c.commit.committer?.date ?? c.commit.author?.date ?? '',
                    assunto: assunto.trim(),
                    corpo: resto.join('\n').trim(),
                }
            })
        },

        async comparar(repositorio, base, topo) {
            const corpo = await pedir<{
                files?: { filename: string; status: ArquivoComparado['status']; previous_filename?: string }[]
            }>(`/repos/${repositorio}/compare/${base}...${topo}?per_page=300`)

            return (corpo.files ?? []).map((f) => ({
                caminho: f.filename,
                status: f.status,
                ...(f.previous_filename === undefined ? {} : { caminhoAnterior: f.previous_filename }),
            }))
        },
    }
}

/**
 * Base64 do GitHub vem quebrado em linhas de 60 caracteres e pode conter UTF-8
 * de verdade (acentos nos comentários dos apps). `atob` sozinho devolveria
 * latin1 quebrado; decodifica em bytes e depois como UTF-8.
 */
export function decodificarBase64(texto: string): string {
    const limpo = texto.replace(/\s+/g, '')
    const binario = atob(limpo)
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
}
