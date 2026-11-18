import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Aviso, Botao, Campo, Quando, Selo, Vazio } from '../componentes/ui.tsx'

/**
 * O portal de contingência (seção 7, item 3): "Meus chamados" fora do
 * aplicativo, para quando o aplicativo não abre nem a tela de login.
 *
 * Mora dentro da SPA do Console por economia — é o mesmo build, o mesmo Worker
 * e as mesmas primitivas de tela —, mas é **público**: nenhuma chamada daqui
 * passa por `api.ts`, que fala com `/api/console` e exige sessão de agente.
 * Quem entra aqui é cliente, não atendente, e a separação dos dois espaços de
 * rota é o que impede confundi-los (ADR 0009).
 *
 * **O token sai da barra de endereços assim que a página carrega.** Ele é a
 * credencial; deixá-lo na URL o escreveria no histórico do navegador e no
 * `Referer` de qualquer link clicado a partir daqui. Fica em `sessionStorage`,
 * que morre com a aba, para um F5 durante a pane não exigir outro e-mail.
 */

interface ChamadoNoPortal {
    numero: string
    sequencial: number
    assunto: string
    grupo: string
    status: string
    criadoEm: string
    atualizadoEm: string
}

interface Resposta {
    app: { slug: string; nome: string; url: string | null }
    usuario: { nome: string }
    chamados: ChamadoNoPortal[]
}

interface Mensagem {
    autor: string
    corpo: string
    criadoEm: string
}

const chaveDaAba = (slug: string) => `venn-desk-portal:${slug}`

function lerCredencial(slug: string): { u: string; t: string } | null {
    const daUrl = new URLSearchParams(window.location.search)
    const u = daUrl.get('u')
    const t = daUrl.get('t')

    if (u !== null && t !== null) {
        try {
            sessionStorage.setItem(chaveDaAba(slug), JSON.stringify({ u, t }))
        } catch {
            /// Aba anônima com armazenamento bloqueado: o portal ainda funciona
            /// nesta visita, só não sobrevive a um F5.
        }
        /// Tira da barra ANTES de qualquer requisição sair daqui.
        window.history.replaceState(null, '', `/portal/${slug}`)
        return { u, t }
    }

    try {
        const guardado = sessionStorage.getItem(chaveDaAba(slug))
        return guardado === null ? null : (JSON.parse(guardado) as { u: string; t: string })
    } catch {
        return null
    }
}

async function pedir<T>(caminho: string, credencial: { u: string; t: string }): Promise<T> {
    const separador = caminho.includes('?') ? '&' : '?'
    const r = await fetch(
        `${caminho}${separador}u=${encodeURIComponent(credencial.u)}&t=${encodeURIComponent(credencial.t)}`
    )
    const corpo = (await r.json()) as T & { erro?: { mensagem: string } }
    if (!r.ok) throw new Error(corpo.erro?.mensagem ?? 'Não foi possível carregar.')
    return corpo
}

export function Portal() {
    const { app = '' } = useParams()
    const [credencial, setCredencial] = useState<{ u: string; t: string } | null>(null)
    const [dados, setDados] = useState<Resposta | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [aberto, setAberto] = useState<number | null>(null)

    useEffect(() => {
        /// O `index.html` é o do Console, que é tela interna. Um cliente no
        /// meio de uma pane não deve ver "Console" na aba dele.
        document.title = dados === null ? 'Suporte · Venn360' : `Suporte · ${dados.app.nome}`
    }, [dados])

    useEffect(() => {
        const achada = lerCredencial(app)
        setCredencial(achada)
        if (achada === null) return

        pedir<Resposta>(`/api/portal/app/${app}/chamados`, achada)
            .then(setDados)
            .catch((e: Error) => {
                setErro(e.message)
                /// Link vencido não deve ficar numa aba tentando de novo.
                try {
                    sessionStorage.removeItem(chaveDaAba(app))
                } catch {
                    /* sem armazenamento, nada a limpar */
                }
                setCredencial(null)
            })
    }, [app])

    return (
        <div className="min-h-screen bg-superficie-2">
            <header className="border-b border-borda bg-superficie">
                <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
                    <span className="font-semibold">{dados?.app.nome ?? 'Suporte'}</span>
                    <span className="text-xs text-tinta-fraca">central de atendimento</span>
                    {dados?.app.url ? (
                        <a
                            href={dados.app.url}
                            className="ml-auto text-xs text-tinta-fraca hover:text-tinta hover:underline"
                        >
                            abrir o aplicativo
                        </a>
                    ) : null}
                </div>
            </header>

            <main className="mx-auto max-w-3xl px-4 py-8">
                {erro !== null ? <Aviso>{erro}</Aviso> : null}

                {credencial === null ? (
                    <PedirAcesso app={app} />
                ) : dados === null ? (
                    <Vazio>carregando…</Vazio>
                ) : aberto === null ? (
                    <Lista dados={dados} aoAbrir={setAberto} />
                ) : (
                    <Conversa
                        app={app}
                        numero={aberto}
                        credencial={credencial}
                        aoVoltar={() => setAberto(null)}
                    />
                )}
            </main>
        </div>
    )
}

/**
 * O pedido de acesso. A resposta é a MESMA para e-mail conhecido e
 * desconhecido — a tela não acrescenta juízo ao que o servidor respondeu, senão
 * desfaria no navegador a discrição que o servidor tomou o cuidado de ter.
 */
function PedirAcesso({ app }: { app: string }) {
    const [email, setEmail] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [recibo, setRecibo] = useState<string | null>(null)

    async function enviar() {
        setEnviando(true)
        try {
            const r = await fetch(`/api/portal/app/${app}/entrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, idioma: idiomaDoNavegador() }),
            })
            const corpo = (await r.json()) as { mensagem?: string; erro?: { mensagem: string } }
            setRecibo(corpo.mensagem ?? corpo.erro?.mensagem ?? 'Tente novamente em um minuto.')
        } catch {
            setRecibo('Não foi possível pedir o acesso agora. Tente novamente em um minuto.')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="mx-auto max-w-md rounded-md border border-borda bg-superficie p-5">
            <h1 className="text-base font-semibold">Acessar meus chamados</h1>
            <p className="mb-4 mt-1 text-sm text-tinta-fraca">
                Informe o e-mail que você usa no aplicativo. Enviamos um link de acesso para ele.
            </p>
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    void enviar()
                }}
                className="space-y-3"
            >
                <Campo rotulo="Seu e-mail" valor={email} onChange={setEmail} tipo="email" requerido />
                <Botao tipo="submit" desabilitado={enviando}>
                    {enviando ? 'Enviando…' : 'Receber link de acesso'}
                </Botao>
            </form>
            {recibo !== null ? <p className="mt-3 text-sm text-tinta-fraca">{recibo}</p> : null}
        </div>
    )
}

function Lista({ dados, aoAbrir }: { dados: Resposta; aoAbrir: (n: number) => void }) {
    if (dados.chamados.length === 0) {
        return <Vazio>Você ainda não tem chamados neste aplicativo.</Vazio>
    }

    return (
        <>
            <p className="mb-4 text-sm text-tinta-fraca">
                Olá, {dados.usuario.nome}. Estes são os seus chamados.
            </p>
            <ul className="space-y-2">
                {dados.chamados.map((chamado) => (
                    <li key={chamado.numero}>
                        <button
                            onClick={() => aoAbrir(chamado.sequencial)}
                            className="flex w-full flex-wrap items-center gap-3 rounded-sm border border-borda bg-superficie px-4 py-3 text-left transition hover:border-destaque"
                        >
                            <span className="font-mono text-xs text-tinta-fraca">{chamado.numero}</span>
                            <span className="flex-1 text-sm font-medium">{chamado.assunto}</span>
                            <Selo>{chamado.status}</Selo>
                            <Quando iso={chamado.atualizadoEm} />
                        </button>
                    </li>
                ))}
            </ul>
        </>
    )
}

function Conversa({
    app,
    numero,
    credencial,
    aoVoltar,
}: {
    app: string
    numero: number
    credencial: { u: string; t: string }
    aoVoltar: () => void
}) {
    const [dados, setDados] = useState<{
        chamado: { numero: string; assunto: string; status: string; criadoEm: string }
        mensagens: Mensagem[]
    } | null>(null)
    const [erro, setErro] = useState<string | null>(null)

    useEffect(() => {
        pedir<{
            chamado: { numero: string; assunto: string; status: string; criadoEm: string }
            mensagens: Mensagem[]
        }>(`/api/portal/app/${app}/chamados/${numero}`, credencial)
            .then(setDados)
            .catch((e: Error) => setErro(e.message))
    }, [app, numero, credencial])

    if (erro !== null) return <Aviso>{erro}</Aviso>
    if (dados === null) return <Vazio>carregando…</Vazio>

    return (
        <>
            <button onClick={aoVoltar} className="mb-4 text-sm text-tinta-fraca hover:underline">
                ← todos os chamados
            </button>
            <div className="rounded-md border border-borda bg-superficie p-5">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-tinta-fraca">{dados.chamado.numero}</span>
                    <h1 className="flex-1 text-base font-semibold">{dados.chamado.assunto}</h1>
                    <Selo>{dados.chamado.status}</Selo>
                </div>
                <ul className="space-y-4">
                    {dados.mensagens.map((m, i) => (
                        <li key={i} className="border-t border-borda pt-3 first:border-0 first:pt-0">
                            <div className="mb-1 flex items-center gap-2">
                                <span className="text-xs font-medium">
                                    {m.autor === 'USUARIO' ? 'Você' : 'Suporte'}
                                </span>
                                <Quando iso={m.criadoEm} />
                            </div>
                            <p className="whitespace-pre-wrap text-sm">{m.corpo}</p>
                        </li>
                    ))}
                </ul>
            </div>
            <p className="mt-4 text-xs text-tinta-fraca">
                Para responder, use o aplicativo. Este portal existe para quando ele não abre.
            </p>
        </>
    )
}

function idiomaDoNavegador(): 'pt-BR' | 'en' | 'es' {
    for (const pedido of navigator.languages ?? [navigator.language]) {
        const curto = String(pedido).toLowerCase()
        if (curto.startsWith('pt')) return 'pt-BR'
        if (curto.startsWith('es')) return 'es'
        if (curto.startsWith('en')) return 'en'
    }
    return 'pt-BR'
}
