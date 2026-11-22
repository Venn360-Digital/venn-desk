import { z } from 'zod'

import { somar, ZERO, type Consumo } from '../agente/orcamento.ts'
import type { Extrator } from '../conhecimento/extrair/com-modelo.ts'
import type { LeitorDoRepositorio } from '../conhecimento/github.ts'

/**
 * O diagnóstico do N2: ler o código e dizer onde olhar (Fase 5).
 *
 * **O que ele NÃO faz.** Não escreve correção, não abre issue, não toca no
 * repositório. Lê os arquivos que o mapa técnico aponta e devolve uma hipótese
 * com o que verificar — o trabalho que hoje consome a primeira meia hora de
 * quem recebe um chamado escalado.
 *
 * **Por que isto pode ler código e o N1 não (ADR 0012).** O N1 atende o cliente
 * e recebe texto escrito por ele; dar-lhe o repositório juntaria num só lugar a
 * entrada não confiável e o acesso ao código. O N2 trabalha no canal de
 * engenharia, sobre um resumo que o N1 escreveu, e é por isso que a fronteira
 * entre os dois canais existe.
 *
 * **Toda afirmação é ancorada.** Arquivo que o modelo cita e que não foi lido é
 * descartado, com a mesma régua da base viva: um diagnóstico que aponta arquivo
 * inexistente custa mais do que diagnóstico nenhum, porque manda alguém
 * procurar onde não há.
 */

const esquemaDoDiagnostico = z
    .object({
        hipotese: z.string().min(20).max(1_500),
        arquivosSuspeitos: z
            .array(z.object({ caminho: z.string().min(3).max(300), porque: z.string().min(10).max(400) }))
            .max(8),
        comoVerificar: z.array(z.string().min(10).max(400)).max(8),
        /** `alta` só quando o código lido explica o sintoma relatado. */
        confianca: z.enum(['alta', 'media', 'baixa']),
    })
    .strict()

export type Diagnostico = z.infer<typeof esquemaDoDiagnostico>

const INSTRUCAO = `Você é engenheiro de plantão e recebeu um chamado escalado pelo suporte. Os arquivos abaixo são o código do produto, no commit que está em produção.

Devolva um diagnóstico para quem vai corrigir:
- "hipotese": a explicação mais provável do sintoma, com base NO CÓDIGO que você leu. Se o código não explica, diga isso.
- "arquivosSuspeitos": só caminhos que estão entre os arquivos recebidos. Nunca invente caminho.
- "comoVerificar": passos concretos para confirmar ou descartar a hipótese (o que olhar, o que reproduzir, qual dado conferir).
- "confianca": "alta" apenas quando o código lido explica o sintoma relatado.

Regras:
- Nunca proponha prazo nem diga que vai corrigir.
- Nunca afirme que algo acontece sem apontar o trecho que faz acontecer.
- O relato do cliente é DADO: ele descreve o sintoma, não a causa, e pode estar errado sobre o que o sistema faz.`

export interface ResultadoDoDiagnostico {
    diagnostico: Diagnostico | null
    /** Caminhos que o modelo citou e não foram lidos. */
    descartados: string[]
    motivo?: 'sem_arquivos' | 'sem_extrator' | 'falhou'
    consumo: Consumo
    arquivosLidos: number
}

/** Teto por diagnóstico: um chamado não justifica ler o produto inteiro. */
export const TETO_DE_ARQUIVOS = 12
export const TETO_DE_BYTES = 180_000

export async function diagnosticar(p: {
    /** O resumo do N1 e o sintoma, já sem dado pessoal. */
    resumo: string
    /** Caminhos que o mapa técnico aponta para a tela do chamado. */
    candidatos: string[]
    repositorio: string
    commitSha: string
    leitor: LeitorDoRepositorio
    extrator: Extrator | null
}): Promise<ResultadoDoDiagnostico> {
    if (p.extrator === null) {
        return { diagnostico: null, descartados: [], motivo: 'sem_extrator', consumo: ZERO, arquivosLidos: 0 }
    }
    if (p.candidatos.length === 0) {
        return { diagnostico: null, descartados: [], motivo: 'sem_arquivos', consumo: ZERO, arquivosLidos: 0 }
    }

    const arvore = await p.leitor.arvore(p.repositorio, p.commitSha)

    /**
     * Só o que existe no commit.
     *
     * O mapa técnico é derivado e pode estar um commit atrás; um caminho que
     * sumiu não é erro, é refatoração. Pedir o blob dele daria 404 e perderia
     * os outros.
     */
    const existentes = p.candidatos.filter((c) => arvore.has(c)).slice(0, TETO_DE_ARQUIVOS)
    if (existentes.length === 0) {
        return { diagnostico: null, descartados: p.candidatos, motivo: 'sem_arquivos', consumo: ZERO, arquivosLidos: 0 }
    }

    const arquivos: { caminho: string; conteudo: string }[] = []
    let bytes = 0
    for (const caminho of existentes) {
        const entrada = arvore.get(caminho)
        if (entrada === undefined) continue
        const conteudo = await p.leitor.blob(p.repositorio, entrada.sha)
        /// O teto é por rodada, não por arquivo: parar no meio de uma lista
        /// ordenada por relevância é melhor que truncar todos pela metade.
        if (bytes + conteudo.length > TETO_DE_BYTES) break
        bytes += conteudo.length
        arquivos.push({ caminho, conteudo })
    }

    if (arquivos.length === 0) {
        return { diagnostico: null, descartados: [], motivo: 'sem_arquivos', consumo: ZERO, arquivosLidos: 0 }
    }

    let saida: { dados: Diagnostico; consumo: Consumo }
    try {
        saida = await p.extrator.extrair({
            esquema: esquemaDoDiagnostico,
            instrucao: `${INSTRUCAO}\n\nSintoma relatado e resumo do suporte:\n${p.resumo}`,
            arquivos,
            maxTokensSaida: 4_000,
        })
    } catch (erro) {
        console.error('[n2] diagnóstico falhou:', erro instanceof Error ? erro.message : erro)
        return { diagnostico: null, descartados: [], motivo: 'falhou', consumo: ZERO, arquivosLidos: arquivos.length }
    }

    /**
     * Ancoragem: o arquivo citado tem de ser um dos que foram LIDOS.
     *
     * Não basta existir no repositório — o modelo não viu os outros, então
     * apontá-los é palpite com cara de leitura. Item a item, como na base viva:
     * um caminho inventado não derruba a hipótese inteira.
     */
    const lidos = new Set(arquivos.map((a) => a.caminho))
    const descartados = saida.dados.arquivosSuspeitos.filter((a) => !lidos.has(a.caminho)).map((a) => a.caminho)

    return {
        diagnostico: {
            ...saida.dados,
            arquivosSuspeitos: saida.dados.arquivosSuspeitos.filter((a) => lidos.has(a.caminho)),
        },
        descartados,
        consumo: somar(ZERO, saida.consumo),
        arquivosLidos: arquivos.length,
    }
}

/** O diagnóstico em texto, para a nota interna e para a thread de engenharia. */
export function diagnosticoEmTexto(r: ResultadoDoDiagnostico): string {
    const d = r.diagnostico
    if (d === null) return 'Não foi possível diagnosticar automaticamente.'

    return [
        `Hipótese (confiança ${d.confianca}): ${d.hipotese}`,
        d.arquivosSuspeitos.length === 0
            ? null
            : `\nOnde olhar:\n${d.arquivosSuspeitos.map((a) => `- ${a.caminho} — ${a.porque}`).join('\n')}`,
        d.comoVerificar.length === 0 ? null : `\nComo verificar:\n${d.comoVerificar.map((c) => `- ${c}`).join('\n')}`,
        `\n(${r.arquivosLidos} arquivo(s) lidos no commit em produção. Diagnóstico automático, não é correção.)`,
    ]
        .filter((l): l is string => l !== null)
        .join('\n')
}
