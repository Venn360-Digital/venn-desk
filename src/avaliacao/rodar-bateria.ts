import type { LanguageModel } from 'ai'

import type { App, KbArticle, PrismaClient } from '#prisma'

import { atender } from '../agente/atender.ts'
import { custoEstimado, type Tarifa } from '../agente/orcamento.ts'
import type { EscopoDoApp } from '../dados/escopo.ts'
import { textoDeBusca, VISIVEL } from '../dominio/artigo.ts'
import { parecidos } from '../dominio/busca.ts'
import type { Contexto } from '../mcp/executar.ts'
import { conferirCaso, type CasoDaBateria, type ResultadoDoCaso } from './bateria.ts'

/**
 * Roda um caso da bateria contra o modelo de verdade, com a BASE de verdade.
 *
 * **Por que a base real, e não uma falsa.** O que a bateria mede é se o agente
 * acha a resposta que a empresa tem escrita. Com artigos inventados aqui, ela
 * mediria se ele acha o que eu inventei — e o número subiria sem nada melhorar
 * em produção.
 *
 * **Sem banco de escrita.** Os artigos chegam prontos (uma leitura, fora deste
 * laço) e tudo que o agente grava fica em memória. Cem casos por app não devem
 * deixar cem chamados na fila de quem atende.
 *
 * **A busca aqui é a por PALAVRA, sem vetor.** O Workers AI vive no Worker, e a
 * bateria roda em Node. Isso faz dela o PIOR caso: o que passar aqui passa em
 * produção, onde a busca é híbrida. O relatório diz isso, para ninguém ler o
 * número como se fosse o teto.
 */

export interface Observacao {
    aoCliente: string[]
    notas: string[]
    escalou: string[]
    artigosLidos: string[]
    /** O que a busca devolveu, com o tamanho: artigo curto cabe no resumo. */
    artigosDevolvidos: { chave: string; tamanho: number }[]
    /** Tudo que chegou ao agente, com o texto que ele viu. */
    vistos: { chave: string; texto: string; aberto: boolean }[]
}

function escopoComBase(caso: CasoDaBateria, artigos: KbArticle[], obs: Observacao): EscopoDoApp {
    const agora = new Date()
    const chamado = {
        id: 'chamado-bateria',
        appId: 'app-bateria',
        numero: 1,
        assunto: caso.assunto,
        status: 'ABERTO',
        tipo: 'DUVIDA',
        prioridade: 'NORMAL',
        nivel: 'N1',
        requesterId: 'sol-bateria',
        tenantId: 'ten-bateria',
        assigneeId: null,
        primeiraRespostaEm: null,
        /// A tela em que o cliente estava, como o widget a manda.
        contexto: caso.rota === undefined ? null : { rota: caso.rota },
        criadoEm: agora,
        atualizadoEm: agora,
    }

    const naoDeveria = (familia: string) => () => {
        throw new Error(`o caso ${caso.id} alcançou ${familia}, que não deveria existir aqui`)
    }

    const publicados = artigos.filter((a) => a.status === VISIVEL)

    return {
        appId: 'app-bateria',

        chamados: {
            porNumero: async () => chamado,
            porId: async () => chamado,
            daFila: async () => [chamado],
            mudarStatus: async () => chamado,
            aplicarEvento: async () => chamado,
            classificar: async () => chamado,
            atribuir: async () => chamado,
            abrir: naoDeveria('chamados.abrir'),
            buscar: async () => [],
            listar: async () => [],
        },

        mensagens: {
            adicionar: async (dados: { corpo: string; visibilidade?: string }) => {
                if (dados.visibilidade === 'INTERNA') obs.notas.push(dados.corpo)
                else obs.aoCliente.push(dados.corpo)
                return { id: 'msg-bateria', corpo: dados.corpo }
            },
            todas: async () => [
                { id: 'msg-1', corpo: caso.mensagem, visibilidade: 'PUBLICA', autor: 'USUARIO', rascunho: false, criadoEm: agora },
            ],
        },

        solicitantes: { porId: async () => ({ id: 'sol-bateria', nome: 'Ana Recepção' }) },
        empresas: { porId: async () => ({ id: 'ten-bateria', nome: 'Unidade de Prova', plano: 'pro' }) },
        sla: { doChamado: async () => [] },

        eventos: {
            registrar: async (dados: { evento: string }) => {
                const [tipo, para] = dados.evento.split(':')
                if (tipo === 'escalar') obs.escalou.push(para ?? '?')
                return { id: 'ev-bateria' }
            },
            doChamado: async () => [],
        },

        artigos: {
            /**
             * A mesma pontuação que o escopo real usa, sobre os mesmos artigos.
             * Reusar `parecidos` e `textoDeBusca` é o que torna o resultado
             * comparável com produção, em vez de medir outra busca.
             */
            buscar: async (texto: string, limite: number) => {
                const achados = parecidos(
                    publicados.map((artigo) => ({ artigo, assunto: textoDeBusca(artigo) })),
                    texto,
                    limite
                ).map(({ item, nota }) => ({ artigo: item.artigo, nota }))

                /// Registra o que foi DEVOLVIDO, com o tamanho: para artigo
                /// curto, o resumo da busca já é o artigo inteiro.
                for (const { artigo } of achados) {
                    if (artigo.chave == null) continue
                    obs.artigosDevolvidos.push({ chave: artigo.chave, tamanho: artigo.corpo.length })
                    if (!obs.vistos.some((v) => v.chave === artigo.chave)) {
                        obs.vistos.push({ chave: artigo.chave, texto: artigo.corpo, aberto: false })
                    }
                }
                return achados
            },

            porId: async (id: string) => {
                const artigo = publicados.find((a) => a.id === id) ?? null
                if (artigo?.chave != null) {
                    obs.artigosLidos.push(artigo.chave)
                    const visto = obs.vistos.find((v) => v.chave === artigo.chave)
                    if (visto === undefined) obs.vistos.push({ chave: artigo.chave, texto: artigo.corpo, aberto: true })
                    else visto.aberto = true
                }
                return artigo
            },

            porChave: async (chave: string) => artigos.find((a) => a.chave === chave) ?? null,
            listar: async () => artigos,
            registrarConsulta: async () => ({ id: 'consulta-bateria' }),
            marcarLeitura: async () => undefined,
            criar: naoDeveria('artigos.criar'),
            alterar: naoDeveria('artigos.alterar'),
        },

        problemas: { porId: async () => null, abrir: naoDeveria('problemas.abrir') },
        anexos: { doChamado: async () => [] },
        contas: { porId: async () => null },
        saude: { estado: async () => null },
        csat: { doChamado: async () => null },
    } as unknown as EscopoDoApp
}

export interface PedidoDeCaso {
    caso: CasoDaBateria
    modelo: LanguageModel
    app: App
    artigos: KbArticle[]
    tarifa: Tarifa
}

export async function rodarCasoDaBateria(p: PedidoDeCaso): Promise<ResultadoDoCaso> {
    const obs: Observacao = { aoCliente: [], notas: [], escalou: [], artigosLidos: [], artigosDevolvidos: [], vistos: [] }

    const contexto: Contexto = {
        cliente: null as unknown as PrismaClient,
        escopoDoApp: escopoComBase(p.caso, p.artigos, obs),
        app: p.app,
        escopo: 'SUPORTE',
    }

    const atendimento = await atender({
        modelo: p.modelo,
        contexto,
        numero: 1,
        tarifa: p.tarifa,
        /**
         * Teto por caso: um atendimento com base chega a oito passos (ler,
         * buscar, ler artigo, classificar, anotar, responder). Doze dá folga e
         * ainda corta quem se perdeu — e cem casos com teto de trinta seria
         * dinheiro gasto em laço.
         */
        teto: { passos: 12, tokens: 200_000 },
    })

    const aoCliente = obs.aoCliente.join('\n')
    const { passou, falhas, sinais, desfecho, natureza } = conferirCaso(p.caso, {
        aoCliente,
        escalouPara: obs.escalou,
        artigosLidos: obs.artigosLidos,
        artigosDevolvidos: obs.artigosDevolvidos,
        vistos: obs.vistos,
    })

    return {
        caso: p.caso,
        passou,
        falhas,
        sinais,
        ...(natureza === undefined ? {} : { natureza }),
        aoCliente,
        desfecho,
        artigosLidos: obs.artigosLidos,
        custoEstimado: Number(custoEstimado(atendimento.consumo, p.tarifa).toFixed(4)),
    }
}
