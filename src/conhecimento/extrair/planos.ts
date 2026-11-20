import { z } from 'zod'

import { ancorar } from './ancorar.ts'
import type { Extrator } from './com-modelo.ts'
import { ErroDeExtracao, type Extracao } from '../tipos.ts'

/**
 * Planos, preços e limites, a partir de `plan-limits.ts` ("esta é a fonte da
 * verdade") e `plans.ts` (as frases comerciais dos cartões).
 *
 * Os números são o que importa aqui, e número é o que o modelo mais erra de
 * memória — então a ancoragem roda sobre os números também: cada preço e cada
 * limite da saída precisa aparecer no arquivo como está (`10_000` vira
 * `10000` nos dois lados antes de comparar).
 */

const inteiro = z.number().int().nonnegative()

export const esquemaDosPlanos = z
    .object({
        planos: z
            .array(
                z
                    .object({
                        id: z.enum(['flow', 'pro', 'advanced']),
                        nome: z.string().trim().min(3).max(40),
                        precoMensal: z.number().positive(),
                        descricao: z.string().trim().max(200),
                        limites: z
                            .object({
                                unidades: inteiro,
                                agentes: inteiro,
                                numerosWhatsApp: inteiro,
                                creditos: inteiro,
                                mensagens: inteiro,
                                respostasFaladas: inteiro,
                                destinatariosBroadcastMes: inteiro,
                                emailsMes: inteiro,
                            })
                            .strict(),
                        itens: z.array(z.string().trim().min(3).max(160)).max(20),
                    })
                    .strict()
            )
            .length(3),
        unidadeAdicional: z
            .object({ precoMensal: z.number().positive(), inclui: z.array(z.string().trim().max(120)).max(10) })
            .strict(),
        descontoAnual: z.number().min(0).max(1),
    })
    .strict()

export type Planos = z.infer<typeof esquemaDosPlanos>

const INSTRUCAO = `Você transcreve a tabela de planos de um produto a partir de dois arquivos TypeScript.
De plan-limits.ts: PLAN_LIMITS (um objeto por plano: flow, pro, advanced), PLAN_NAMES, PLAN_PRICES, PRECO_ADICIONAL, ADICIONAL_INCLUI e DESCONTO_ANUAL.
De plans.ts: para cada plano, a description e os textos de features (campo text), na ordem.
Devolva:
- planos[]: id, nome (PLAN_NAMES), precoMensal (PLAN_PRICES), descricao (description), limites (os oito campos de PLAN_LIMITS mapeados: maxWorkspaces→unidades, maxAgents→agentes, maxWhatsAppNumbers→numerosWhatsApp, credits→creditos, maxMessages→mensagens, maxSpokenReplies→respostasFaladas, maxBroadcastRecipientsPerMonth→destinatariosBroadcastMes, maxEmailsPerMonth→emailsMes), itens (os text das features).
- unidadeAdicional: precoMensal (PRECO_ADICIONAL) e inclui (os campos de ADICIONAL_INCLUI com valor maior que zero, escritos como "1 unidade", "1 agente", "1 número de WhatsApp").
- descontoAnual (DESCONTO_ANUAL).
Quando um texto interpola o vocabulário (\${v.organizacoes}, \${v.pessoas}, comArtigo(v, 'organizacao', 'de')), escreva o placeholder {{organizacoes}}, {{pessoas}}, {{organizacao}} no lugar — a chave exata depois de "v.".
Números: escreva como número, sem separador (10_000 vira 10000). Transcreva; não arredonde, não complete, não invente.`

export async function extrairPlanos(
    arquivos: { planLimitsTs: string; plansTs: string },
    extrator: Extrator
): Promise<Extracao<Planos>> {
    const { dados, consumo } = await extrator.extrair({
        esquema: esquemaDosPlanos,
        instrucao: INSTRUCAO,
        arquivos: [
            { caminho: 'packages/core/src/lib/plan-limits.ts', conteudo: arquivos.planLimitsTs },
            { caminho: 'packages/core/src/lib/plans.ts', conteudo: arquivos.plansTs },
        ],
        maxTokensSaida: 4_000,
    })

    const fontes = [arquivos.planLimitsTs, arquivos.plansTs]
    const ancoragem = ancorar(dados, fontes, [/^\d+ (unidade|agente|número de WhatsApp)s?$/])
    if (!ancoragem.ok) {
        throw new ErroDeExtracao('planos', `textos que não existem nos arquivos: ${ancoragem.soltas.join(' | ')}`, consumo)
    }

    /// Os números também se ancoram: cada preço e limite tem de existir no
    /// arquivo como está. O modelo "lembrar" R$ 290 quando o arquivo diz 390
    /// é o erro mais caro que esta fonte pode cometer.
    const texto = fontes.join('\n').replace(/_/g, '')
    const numeros = [
        ...dados.planos.flatMap((p) => [p.precoMensal, ...Object.values(p.limites)]),
        dados.unidadeAdicional.precoMensal,
    ]
    const soltos = numeros.filter((n) => !new RegExp(`(?<!\\d)${n}(?!\\d)`).test(texto))
    if (soltos.length > 0) {
        throw new ErroDeExtracao('planos', `números que não existem nos arquivos: ${soltos.join(', ')}`, consumo)
    }

    return { dados, extraidoPor: 'modelo', consumo }
}
