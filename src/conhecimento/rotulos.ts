import { dobrar } from '../dominio/busca.ts'

/**
 * Os textos de procedência — montados pelo Desk, nunca pelo modelo.
 *
 * O rodapé "Fonte: …" é o que diz ao agente (e a quem lê o Console) de onde
 * aquele artigo veio e quão fresco está. Ele é montado aqui, a partir do que o
 * sincronizador SABE (caminho, sha, data), e nunca a partir do que o modelo
 * escreveu — um artigo não pode alegar a própria fonte.
 */

export interface Procedencia {
    /** "perguntas frequentes do Odontobox360", "menu do produto" */
    descricao: string
    caminhos: string[]
    commit: string
}

/**
 * Até quantos caminhos o rodapé nomeia antes de resumir.
 *
 * Uma tela com seis arquivos rendia 400 caracteres de rodapé para 1.600 de
 * conteúdo — e o agente lê o artigo inteiro a cada passo. O que o rodapé
 * precisa provar é a procedência, e para isso basta o arquivo principal, a
 * contagem do resto e o commit uma vez.
 */
const CAMINHOS_NO_RODAPE = 2

export function rodape(p: Procedencia): string {
    const curto = p.commit.slice(0, 7)
    const nomeados = p.caminhos.slice(0, CAMINHOS_NO_RODAPE)
    const resto = p.caminhos.length - nomeados.length
    const lista = nomeados.join(', ') + (resto > 0 ? ` e mais ${resto} arquivo${resto > 1 ? 's' : ''}` : '')

    return `---\nFonte: ${p.descricao} (${lista} @ ${curto})`
}

const FUSO = 'America/Sao_Paulo'

/** "Fonte: menu do produto, sincronizado em 19/11 às 14h, commit 7c70f74". */
export function rotuloDaOrigem(artigo: {
    origem: string
    fonte: unknown
    sincronizadoEm: Date | null
}): string | null {
    if (artigo.origem === 'MANUAL') return null

    const fonte = (artigo.fonte ?? {}) as { descricao?: string; commit?: string; ticketId?: string }
    const quando =
        artigo.sincronizadoEm === null
            ? ''
            : `, sincronizado em ${new Intl.DateTimeFormat('pt-BR', {
                  timeZone: FUSO,
                  day: '2-digit',
                  month: '2-digit',
              }).format(artigo.sincronizadoEm)} às ${new Intl.DateTimeFormat('pt-BR', {
                  timeZone: FUSO,
                  hour: '2-digit',
              }).format(artigo.sincronizadoEm)}h`

    if (artigo.origem === 'SUGERIDO') {
        return `Fonte: sugerido pelo Desk a partir do atendimento${fonte.ticketId === undefined ? '' : ' (chamado resolvido por uma pessoa)'}; aguarda aprovação.`
    }

    const commit = fonte.commit === undefined ? '' : `, commit ${fonte.commit.slice(0, 7)}`
    return `Fonte: ${fonte.descricao ?? 'derivado do produto'}${quando}${commit}`
}

/** O endereço do arquivo no GitHub, para o Console linkar. */
export function urlDaFonte(repositorio: string, caminho: string, commit: string): string {
    return `https://github.com/${repositorio}/blob/${commit}/${caminho.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Um slug estável para a chave do artigo: minúsculo, sem acento, hifenado,
 * cortado em 60. Estável porque a chave é o que faz a re-sincronização ser
 * upsert — mudar o algoritmo duplicaria todos os derivados.
 */
export function slug(texto: string): string {
    return dobrar(texto)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '')
}
