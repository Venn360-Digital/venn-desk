import type { Prisma } from '#prisma'

import { custoEstimado, somar, ZERO, type Consumo, type Tarifa } from '../agente/orcamento.ts'
import type { EscopoDoApp } from '../dados/escopo.ts'
import { textoDeBusca } from '../dominio/artigo.ts'
import { extrairVocabulario } from './extrair/vocabulario.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import { extrairTela, type ArquivoDaTela, type Tela } from './extrair/tela.ts'
import { caminhoDoVocabulario } from './fontes.ts'
import type { LeitorDoRepositorio } from './github.ts'
import { esquemaDoMenu } from './extrair/menu.ts'
import { CHAVE_MENU } from './renderizar/menu.ts'
import { chaveDaTela, renderizarTela } from './renderizar/tela.ts'
import { nomeDaTela } from './rota.ts'
import { ATOR } from './sincronizar.ts'
import type { AppSincronizavel } from './tipos.ts'
import type { ArquivoEscolhido } from './mapa/contexto-da-tela.ts'

/**
 * Documentar uma tela: **uma extração, três artigos.**
 *
 * As telas moram em `packages/core` e são as mesmas nos três produtos — só o
 * vocabulário muda ("Procedimentos" no Odontobox, "Serviços" no Conecta).
 * Extrair por app pagaria três vezes pelo mesmo trabalho, então a chamada ao
 * modelo acontece uma vez, com placeholders, e a renderização roda por app.
 *
 * Cada app continua com o próprio escopo e o próprio `appId` em toda escrita: o
 * isolamento não afrouxa porque a extração é compartilhada.
 */

export interface PedidoDeDocumentacao {
    rota: string
    arquivos: ArquivoEscolhido[]
    commitSha: string
    apps: AppSincronizavel[]
    escopoDe: (appId: string) => EscopoDoApp
    leitor: LeitorDoRepositorio
    /** O modelo da PRIMEIRA documentação de uma tela. Sonnet, por padrão. */
    extrator: Extrator
    /**
     * O modelo de quando a tela já tinha artigo e só mudou. Haiku: o trabalho é
     * reler um arquivo parecido com o que já rendeu um JSON válido, e a
     * ancoragem reprova se ele errar — caso em que a rodada seguinte, com o
     * artigo ainda desatualizado, tenta de novo.
     */
    extratorIncremental?: Extrator | undefined
    embutir: ((textos: string[]) => Promise<(number[] | null)[]>) | null
    agora: Date
    tarifa: Tarifa
}

export interface ResultadoDaDocumentacao {
    rota: string
    /** Quantos artigos foram gravados, somando os apps. */
    artigos: number
    efeitos: Record<string, string>
    consumo: Consumo
    custoEstimadoUsd: number
}

export async function documentarTela(p: PedidoDeDocumentacao): Promise<ResultadoDaDocumentacao> {
    const repositorio = p.apps[0]?.repositorio ?? ''
    if (repositorio === '') throw new Error('documentarTela: nenhum app no pedido')

    /// Um blob por sha, mesmo que dois apps peçam o mesmo arquivo.
    const blobs = new Map<string, Promise<string>>()
    const ler = (sha: string) => {
        let promessa = blobs.get(sha)
        if (promessa === undefined) {
            promessa = p.leitor.blob(repositorio, sha)
            blobs.set(sha, promessa)
        }
        return promessa
    }

    const caminhos = p.arquivos.map((a) => a.caminho)
    const shas = Object.fromEntries(p.arquivos.map((a) => [a.caminho, a.sha]))
    const chave = chaveDaTela(p.rota)

    /**
     * Quem já está em dia, e quem precisa de trabalho.
     *
     * A mensagem chega uma vez por app (cada job de sincronização enfileira as
     * telas do seu), então a mesma tela é pedida três vezes no mesmo commit. A
     * primeira extrai; as outras duas encontram o JSON já gravado e só
     * renderizam. É isso que faz o modelo ser pago uma vez por tela por commit,
     * e torna a mensagem idempotente — repeti-la não gasta nada.
     */
    const existentes = await Promise.all(
        p.apps.map(async (app) => ({
            app,
            artigo: await p.escopoDe(app.id).artigos.porChave(chave).catch(() => null),
        }))
    )

    const emDia = (artigo: { fonte: unknown } | null): boolean => {
        const fonte = (artigo?.fonte ?? null) as { shas?: Record<string, string>; versaoDoExtrator?: number } | null
        if (fonte === null) return false
        if (fonte.versaoDoExtrator !== VERSAO_DO_EXTRATOR_DE_TELA) return false
        return JSON.stringify(ordenado(fonte.shas ?? {})) === JSON.stringify(ordenado(shas))
    }

    const pendentes = existentes.filter((e) => !emDia(e.artigo))
    if (pendentes.length === 0) {
        return { rota: p.rota, artigos: 0, efeitos: Object.fromEntries(p.apps.map((a) => [a.slug, 'em dia'])), consumo: ZERO, custoEstimadoUsd: 0 }
    }

    /// O JSON de quem já está em dia serve para renderizar os outros, sem
    /// modelo nenhum: a extração é a mesma, só o vocabulário muda.
    const jaExtraido = existentes.find((e) => emDia(e.artigo))?.artigo?.dados ?? null

    let dadosDaTela: Tela
    let consumo: Consumo = ZERO
    if (jaExtraido !== null) {
        const { rota: _rota, ...resto } = jaExtraido as { rota?: string } & Tela
        dadosDaTela = resto as Tela
    } else {
        const arquivos: ArquivoDaTela[] = []
        for (const a of p.arquivos) {
            arquivos.push({ caminho: a.caminho, conteudo: await ler(a.sha), papel: a.papel })
        }
        /// Primeira vez na tela: Sonnet. Já havia artigo (e mudou): Haiku.
        const jaTinhaArtigo = existentes.some((e) => e.artigo !== null)
        const extrator = jaTinhaArtigo && p.extratorIncremental !== undefined ? p.extratorIncremental : p.extrator
        const extracao = await extrairTela(p.rota, arquivos, extrator)
        dadosDaTela = extracao.dados
        consumo = extracao.consumo ?? ZERO
    }

    const efeitos: Record<string, string> = Object.fromEntries(
        existentes.filter((e) => emDia(e.artigo)).map((e) => [e.app.slug, 'em dia'])
    )
    let artigos = 0

    for (const { app } of pendentes) {
        const escopo = p.escopoDe(app.id)

        /// O vocabulário é por app, e a tela é compartilhada: é esta leitura
        /// que faz "Serviços" e "Procedimentos" saírem do mesmo JSON.
        const brand = await p.leitor
            .arvore(repositorio, p.commitSha)
            .then((arvore) => arvore.get(caminhoDoVocabulario(app)))
            .then((entrada) => (entrada === undefined ? null : ler(entrada.sha)))
        if (brand === null) {
            efeitos[app.slug] = 'sem vocabulário'
            continue
        }
        const vocabulario = extrairVocabulario(await brand)

        /**
         * O caminho do menu vem do artigo do menu daquele app — a mesma tabela
         * que a trilha do produto usa. Sem ele (menu falhou nesta rodada), o
         * artigo diz o endereço, que é honesto e serve.
         */
        const artigoDoMenu = await escopo.artigos.porChave(CHAVE_MENU).catch(() => null)
        /// Pelo esquema, não por conversão de tipo: o `dados` de um artigo é
        /// JSON do banco, e um artigo de versão antiga tem outra forma.
        const menu = esquemaDoMenu.safeParse(artigoDoMenu?.dados ?? null)
        const caminhoNoMenu = menu.success ? nomeDaTela(p.rota, menu.data, vocabulario) : null

        const [renderizado] = renderizarTela(
            dadosDaTela,
            p.rota,
            { app, vocabulario, commit: p.commitSha, agora: p.agora },
            caminhos,
            caminhoNoMenu
        )
        if (renderizado === undefined) continue

        const { artigo, efeito } = await escopo.artigos.sincronizarDerivado({
            chave: renderizado.chave,
            titulo: renderizado.titulo,
            corpo: renderizado.corpo,
            tags: renderizado.tags,
            fonte: {
                tipo: 'tela',
                descricao: `a tela ${renderizado.titulo}`,
                repositorio,
                caminhos,
                shas,
                commit: p.commitSha,
                versaoDoExtrator: VERSAO_DO_EXTRATOR_DE_TELA,
                extraidoPor: 'modelo',
            },
            dados: JSON.parse(JSON.stringify(renderizado.dados)) as Prisma.InputJsonValue,
            publicarDireto: true,
            agora: p.agora,
        })

        efeitos[app.slug] = efeito
        if (efeito !== 'inalterado') {
            artigos++
            await escopo.eventosDaBase
                .registrar({
                    artigoId: artigo.id,
                    ator: ATOR,
                    evento: `artigo:derivado-${efeito}`,
                    depois: { fonte: 'tela', rota: p.rota, commit: p.commitSha.slice(0, 7) },
                })
                .catch((e: unknown) => console.error('[conhecimento] evento não gravado:', e))

            if (p.embutir !== null) {
                const [vetor] = await p.embutir([
                    textoDeBusca({ id: artigo.id, titulo: renderizado.titulo, corpo: renderizado.corpo, tags: renderizado.tags }),
                ])
                if (vetor !== null && vetor !== undefined) {
                    await escopo.artigos
                        .gravarEmbedding(artigo.id, vetor)
                        .catch((e: unknown) => console.error('[conhecimento] embedding não gravado:', e))
                }
            }
        }
    }

    return {
        rota: p.rota,
        artigos,
        efeitos,
        consumo,
        custoEstimadoUsd: Number(custoEstimado(consumo, p.tarifa).toFixed(4)),
    }
}

/** Chaves em ordem, para comparar dois mapas de sha sem depender da ordem do JSONB. */
function ordenado(mapa: Record<string, string>): [string, string][] {
    return Object.entries(mapa).sort(([a], [b]) => (a < b ? -1 : 1))
}

/** Sobe quando a forma do artigo de tela muda: a rodada seguinte re-renderiza. */
export const VERSAO_DO_EXTRATOR_DE_TELA = 1

/** Junta os shas de uma tela numa impressão, para saber se ela mudou. */
export function impressaoDaTela(arquivos: ArquivoEscolhido[]): string {
    return arquivos
        .map((a) => `${a.caminho}:${a.sha}`)
        .sort()
        .join('|')
}

export { somar }
