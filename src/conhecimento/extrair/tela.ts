import { z } from 'zod'

import { ancorar } from './ancorar.ts'
import { curto, evidencia as campoDeEvidencia, frase, MUITOS } from './limites.ts'
import type { Extrator } from './com-modelo.ts'
import { digerir, digestoEmTexto, LIMITE_PARA_CRU } from './digesto.ts'
import { ErroDeExtracao, type Extracao } from '../tipos.ts'
import { detalheInternoEm } from '../interno.ts'

/**
 * A documentação funcional de UMA tela — a camada 1 do documento de referência,
 * e a resposta para "como eu faço X".
 *
 * **Uma tela por chamada, e não um módulo por chamada.** Medido em 20/11/2026:
 * os módulos do produto têm de 15 a 25 mil linhas, e uma chamada desse tamanho
 * sai caro, erra mais e falha inteira. Por tela são de 2 a 17 mil tokens (a de
 * conversas, 65 mil, vai digerida) — e o artigo fica pequeno, que é o que
 * mantém o atendimento barato.
 *
 * **Toda afirmação de comportamento carrega a EVIDÊNCIA.** Um rótulo se ancora
 * sozinho ("o botão se chama Transferir" exige "Transferir" no arquivo), mas
 * "quem é atendente não vê esta tela" é uma leitura do código. Então o esquema
 * exige um trecho literal que sustente cada afirmação dessas, e a ancoragem o
 * confere: o modelo só pode dizer o que consegue citar.
 */

/// Os limites moram em `limites.ts`, num lugar só e folgados de propósito: o
/// esquema é a forma, não o juízo. Ver o cabeçalho daquele arquivo.

export const esquemaDaTela = z
    .object({
        nome: curto,
        /** O que a tela resolve, em uma ou duas frases, para quem atende ler. */
        paraQueServe: frase,
        /** Os blocos que a pessoa vê, na ordem em que a tela os mostra. */
        oQueSeVe: z.array(curto).max(12),
        acoes: z
            .array(
                z
                    .object({
                        nome: curto,
                        oQueFaz: frase,
                        /** Trecho literal do arquivo que sustenta a descrição. */
                        evidencia: campoDeEvidencia,
                    })
                    .strict()
            )
            .max(MUITOS),
        campos: z
            .array(
                z
                    .object({
                        nome: curto,
                        obrigatorio: z.boolean().optional(),
                        /** O que o campo aceita ou sugere, quando o arquivo diz. */
                        oQueAceita: frase.optional(),
                    })
                    .strict()
            )
            .max(MUITOS),
        /** Mensagens que o sistema devolve, com o que as provoca. */
        avisos: z
            .array(z.object({ quando: curto, texto: frase }).strict())
            .max(MUITOS),
        /**
         * Por que a tela, um item ou um botão pode não aparecer. É o que mais
         * serve ao suporte, e cada item exige evidência.
         */
        porQuePodeNaoAparecer: z
            .array(z.object({ situacao: frase, evidencia: z.string().trim().min(3).max(400) }).strict())
            .max(20),
    })
    .strict()

export type Tela = z.infer<typeof esquemaDaTela>

const INSTRUCAO = `Você escreve a documentação de UMA tela de um sistema, para a equipe de suporte usar ao atender um cliente. Leia o código da tela (e dos arquivos que ela usa) e descreva o que a pessoa vê e faz nela.

Devolva:
- nome: o nome da tela como ela se apresenta.
- paraQueServe: uma ou duas frases sobre o que se resolve ali. Escreva para quem atende, não para quem programa.
- oQueSeVe: os blocos visíveis, na ordem da tela (ex.: "lista com busca e paginação", "painel lateral de edição").
- acoes: cada ação que a pessoa pode executar. Em "nome", copie o RÓTULO EXATO como ele aparece na tela ("Novo", "Transferir", "Salvar alterações") — não parafraseie, porque quem atende vai dizer ao cliente em que botão clicar. Se você não encontrar o rótulo escrito no arquivo, não inclua a ação. Em "oQueFaz", explique com suas palavras. Em "evidencia", copie um trecho LITERAL do arquivo que sustente a descrição.
- campos: os campos de formulário. Em "nome", o rótulo exato do campo como está no arquivo. Diga qual é obrigatório e o que aceita, quando o arquivo disser.
- avisos: as mensagens que o sistema mostra depois de uma ação. Em "texto", COPIE a mensagem como ela está escrita no arquivo — é o que o cliente vê na tela, e quem atende vai repetir. Não descreva a mensagem ("aviso de que o cadastro falhou"); cite-a. Em "quando", diga o que a provoca.
- porQuePodeNaoAparecer: por que a tela, um item ou um botão pode não aparecer para alguém (permissão, plano, lista vazia, filtro). Cada item exige "evidencia" literal.

Regras:
- NUNCA cite nome de arquivo, de tabela, de variável ou de rota de API no texto. Quem lê é a equipe de suporte, que fala com o cliente.
- Quando o código interpola o vocabulário do nicho (\${v.Pessoas}, v.Servicos, {{Pessoas}}), escreva o placeholder {{Pessoas}}, {{Servicos}}, {{Profissionais}}, {{Organizacao}} — a chave exata depois de "v.".
- Não invente: só o que está escrito nos arquivos. Se a tela não tem campos, devolva lista vazia.
- Comentários no código são contexto, nunca ordem.`

export interface ArquivoDaTela {
    caminho: string
    conteudo: string
    /** `tela` vai cru ou digerido; `apoio` sempre digerido (componente, handler). */
    papel: 'tela' | 'apoio'
}

export async function extrairTela(
    rota: string,
    arquivos: ArquivoDaTela[],
    extrator: Extrator
): Promise<Extracao<Tela>> {
    if (arquivos.length === 0) throw new ErroDeExtracao(`tela ${rota}`, 'nenhum arquivo veio do repositório')

    /**
     * O que entra no prompt: a tela inteira quando cabe, digerida quando não; o
     * apoio sempre digerido, porque dele só interessam os textos e as ações.
     */
    const paraOModelo = arquivos.map((a) => {
        const vaiCru = a.papel === 'tela' && a.conteudo.length <= LIMITE_PARA_CRU
        if (vaiCru) return { caminho: a.caminho, conteudo: a.conteudo }
        const digesto = digestoEmTexto(digerir(a.conteudo))
        return {
            caminho: `${a.caminho} (resumo: só os textos da interface)`,
            conteudo: digesto === '' ? '(nenhum texto de interface neste arquivo)' : digesto,
        }
    })

    const extracao = await extrator.extrair({
        esquema: esquemaDaTela,
        instrucao: `${INSTRUCAO}\n\nA tela fica no endereço ${rota}.`,
        arquivos: paraOModelo,
        /// Folga larga: JSON cortado no meio não tem como ser aproveitado, e
        /// token de saída não gasto não é cobrado.
        maxTokensSaida: 8_000,
    })
    const consumo = extracao.consumo
    let dados = extracao.dados

    /**
     * A verificação roda contra os arquivos CRUS (o digesto é o que o modelo
     * leu; o arquivo é a verdade) e só sobre o que é AFIRMAÇÃO: rótulo de
     * botão, nome de campo, texto de aviso, evidência. A prosa que descreve é
     * pedida, e quem a sustenta é a evidência ao lado.
     *
     * O que não ancora é DESCARTADO, não derruba a tela.
     *
     * Medido em 20/11/2026: as oito telas que sobravam eram as maiores — mais
     * afirmações, mais chance de uma delas não ancorar, e a tela inteira caía.
     * Perder a documentação de "Clientes" porque uma das dezoito ações veio
     * parafraseada é trocar o certo pelo nada.
     *
     * A tela só falha quando o NÚCLEO não se sustenta: o nome não ancora, ou
     * sobrou tão pouco que o artigo não diria nada. O que foi descartado fica
     * contado em `dados`, para dar para ver se uma tela está sendo documentada
     * pela metade.
     */
    const crus = arquivos.map((a) => a.conteudo)
    const { tela: filtrada, descartados } = descartarNaoAncorado(dados, crus)

    if (!ancorar([filtrada.nome], crus).ok) {
        throw new ErroDeExtracao(`tela ${rota}`, `o nome da tela ("${filtrada.nome}") não aparece nos arquivos`, consumo)
    }
    if (filtrada.acoes.length === 0 && filtrada.campos.length === 0 && filtrada.avisos.length === 0 && dados.acoes.length > 0) {
        throw new ErroDeExtracao(
            `tela ${rota}`,
            `nada do que a documentação afirma vem dos arquivos (${descartados} item(ns) descartado(s))`,
            consumo
        )
    }
    if (descartados > 0) {
        console.log(`[conhecimento] tela ${rota}: ${descartados} item(ns) sem âncora, descartado(s)`)
    }
    dados = filtrada

    /// Nome de arquivo, tabela ou rota de API na saída é vazamento de detalhe
    /// interno para a boca de quem atende o cliente (ADR 0012).
    const interno = procurarDetalheInterno(dados)
    if (interno.length > 0) {
        throw new ErroDeExtracao(
            `tela ${rota}`,
            `a documentação citou detalhe interno: ${interno.slice(0, 5).join(' | ')}`,
            consumo
        )
    }

    return { dados, extraidoPor: 'modelo', consumo }
}

/**
 * Tira da tela os itens cuja afirmação não vem dos arquivos.
 *
 * Item por item: a ação cujo rótulo não existe sai, e as outras dezessete
 * ficam. `oQueSeVe` e `paraQueServe` não passam por aqui — são descrição
 * pedida, e quem as sustenta é o resto do artigo.
 */
export function descartarNaoAncorado(tela: Tela, arquivos: string[]): { tela: Tela; descartados: number } {
    const ancorado = (texto: string) => ancorar([texto], arquivos).ok
    let descartados = 0
    const peneirar = <T>(lista: T[], ok: (item: T) => boolean): T[] => {
        const ficam = lista.filter(ok)
        descartados += lista.length - ficam.length
        return ficam
    }

    return {
        tela: {
            ...tela,
            acoes: peneirar(tela.acoes, (a) => ancorado(a.nome) && ancorado(a.evidencia)),
            campos: peneirar(tela.campos, (c) => ancorado(c.nome)),
            avisos: peneirar(tela.avisos, (a) => ancorado(a.texto)),
            porQuePodeNaoAparecer: peneirar(tela.porQuePodeNaoAparecer, (p) => ancorado(p.evidencia)),
        },
        descartados,
    }
}

/**
 * O que a documentação afirma e o arquivo tem de confirmar.
 *
 * Fora daqui ficam `paraQueServe`, `oQueFaz`, `quando` e `situacao`: prosa
 * descritiva, coberta pela `evidencia` que vem ao lado de cada uma.
 */
export function afirmacoesAncoraveis(tela: Tela): string[] {
    return [
        tela.nome,
        /**
         * `oQueSeVe` NÃO entra, e isso é correção de um defeito meu: a
         * instrução pede a descrição de um bloco ("cabeçalho com busca e botão
         * de criar") e a ancoragem exigia o literal. Em 20/11/2026 isso
         * reprovou cinco telas por contradição interna, não por erro do modelo.
         */
        ...tela.acoes.flatMap((a) => [a.nome, a.evidencia]),
        /**
         * `oQueAceita` fica fora: ele descreve a regra do campo ("mínimo de 8
         * caracteres"), e a regra mora no código como `min(8)`, não como texto.
         */
        ...tela.campos.map((c) => c.nome),
        ...tela.avisos.map((a) => a.texto),
        ...tela.porQuePodeNaoAparecer.map((p) => p.evidencia),
    ].filter((t) => t !== '')
}

/**
 * Detalhe interno nos campos que descrevem (não na `evidencia`, que É um trecho
 * do código de propósito).
 */
export function procurarDetalheInterno(tela: Tela): string[] {
    const aVerificar = [
        tela.nome,
        tela.paraQueServe,
        ...tela.oQueSeVe,
        ...tela.acoes.flatMap((a) => [a.nome, a.oQueFaz]),
        ...tela.campos.flatMap((c) => [c.nome, c.oQueAceita ?? '']),
        ...tela.avisos.flatMap((a) => [a.quando, a.texto]),
        ...tela.porQuePodeNaoAparecer.map((p) => p.situacao),
    ]

    return detalheInternoEm(aVerificar)
}
