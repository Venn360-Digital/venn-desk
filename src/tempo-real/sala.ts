/**
 * A sala de um chamado — um Durable Object por chamado.
 *
 * É o mecanismo que a Fase 2 adiou de propósito: em vez de SSE com consulta em
 * laço ao banco, um objeto que sabe quem está olhando aquele chamado e empurra
 * quando algo muda. O mesmo objeto serve as duas coisas que a especificação
 * pede: o SSE que o widget consome agora, e o WebSocket do chat ao vivo —
 * compartilhando a lista de assinantes em vez de duplicá-la.
 *
 * **Guarda nada.** Sem estado persistente: se o objeto hiberna, os assinantes
 * reconectam e o widget relê o chamado pela API. O banco continua sendo a
 * única fonte da verdade, e a sala é só o caminho curto até quem está olhando.
 *
 * **Não é caminho de autorização.** Quem decide se alguém pode ver um chamado é
 * a rota, com o token do app, ANTES de encaminhar para cá. A sala nunca recebe
 * requisição de fora do Worker.
 */

interface Assinante {
    escrever: WritableStreamDefaultWriter<Uint8Array>
    vivo: boolean
}

export interface AvisoDaSala {
    tipo: 'mensagem' | 'status' | 'anexo' | 'digitando' | 'leitura'
    /** Carga pequena de propósito: um empurrão, não a mensagem inteira. */
    resumo?: string
    status?: string
    /**
     * Quem gerou o aviso, nos tipos em que isso decide o que mostrar.
     *
     * `digitando` do solicitante aparece para o atendente e não para ele mesmo;
     * `leitura` é o contrário. Sem o lado, cada ponta mostraria o próprio
     * evento de volta — "você está digitando" na sua própria tela.
     */
    lado?: 'solicitante' | 'atendente'
    /** `leitura`: até quando aquele lado leu, em ISO. */
    em?: string
}

const CODIFICADOR = new TextEncoder()

/** De quanto em quanto tempo mandar um comentário, para a conexão não cair. */
const BATIDA_MS = 25_000

export class SalaDoChamado {
    private assinantes = new Set<Assinante>()
    private batida: number | undefined

    constructor(_estado: DurableObjectState, _env: unknown) {}

    async fetch(requisicao: Request): Promise<Response> {
        const url = new URL(requisicao.url)

        if (url.pathname === '/assinar') return this.assinar()
        if (url.pathname === '/publicar') return this.publicar(requisicao)

        return new Response('rota desconhecida na sala', { status: 404 })
    }

    private assinar(): Response {
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
        const escrever = writable.getWriter()
        const assinante: Assinante = { escrever, vivo: true }
        this.assinantes.add(assinante)

        /// Um comentário SSE inicial fecha o handshake e faz o navegador
        /// considerar a conexão aberta mesmo antes do primeiro evento.
        void escrever.write(CODIFICADOR.encode(': conectado\n\n')).catch(() => {})

        this.garantirBatida()

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store',
                Connection: 'keep-alive',
                /// Sem isto, um proxy intermediário pode esperar o corpo inteiro.
                'X-Accel-Buffering': 'no',
            },
        })
    }

    private async publicar(requisicao: Request): Promise<Response> {
        const aviso = (await requisicao.json()) as AvisoDaSala
        const bloco = CODIFICADOR.encode(
            `event: ${aviso.tipo}\ndata: ${JSON.stringify(aviso)}\n\n`
        )

        await this.difundir(bloco)
        return Response.json({ assinantes: this.assinantes.size })
    }

    private async difundir(bloco: Uint8Array): Promise<void> {
        const mortos: Assinante[] = []

        await Promise.all(
            [...this.assinantes].map(async (a) => {
                try {
                    await a.escrever.write(bloco)
                } catch {
                    /// Aba fechada: a escrita falha e o assinante sai da lista.
                    a.vivo = false
                    mortos.push(a)
                }
            })
        )

        for (const morto of mortos) this.assinantes.delete(morto)
        if (this.assinantes.size === 0) this.pararBatida()
    }

    private garantirBatida(): void {
        if (this.batida !== undefined) return
        this.batida = setInterval(() => {
            void this.difundir(CODIFICADOR.encode(': batida\n\n'))
        }, BATIDA_MS) as unknown as number
    }

    private pararBatida(): void {
        if (this.batida === undefined) return
        clearInterval(this.batida)
        this.batida = undefined
    }
}
