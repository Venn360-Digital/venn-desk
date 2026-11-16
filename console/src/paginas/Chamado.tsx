import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { api, type ChamadoCompleto } from '../api.ts'
import { Aviso, Botao, Quando, Selo, Vazio } from '../componentes/ui.tsx'

/**
 * A tela do chamado. A linha do tempo mostra mensagem pública E nota interna —
 * é a diferença entre esta tela e o widget, e por isso a nota é marcada com
 * clareza: um atendente que confunde as duas manda para o cliente o que era
 * para a equipe.
 *
 * O campo de resposta obriga a escolher: "Responder ao cliente" ou "Nota
 * interna". Sem padrão silencioso — a seção 8 exige o mesmo no Slack, onde
 * responder ao cliente precisa de botão ou prefixo explícito.
 */
export function Chamado() {
    const { app, numero } = useParams<{ app: string; numero: string }>()
    const fila = useQueryClient()
    const [texto, setTexto] = useState('')
    const [erro, setErro] = useState<string | null>(null)

    const chave = ['chamado', app, numero]
    const { data, isPending } = useQuery({
        queryKey: chave,
        queryFn: () => api<ChamadoCompleto>(`/${app}/chamados/${numero}`),
    })

    const responder = useMutation({
        mutationFn: (v: { corpo: string; visibilidade: 'PUBLICA' | 'INTERNA' }) =>
            api(`/${app}/chamados/${numero}/mensagens`, { metodo: 'POST', corpo: v }),
        onSuccess: () => {
            setTexto('')
            setErro(null)
            void fila.invalidateQueries({ queryKey: chave })
            void fila.invalidateQueries({ queryKey: ['fila', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    const evento = useMutation({
        mutationFn: (nome: string) =>
            api(`/${app}/chamados/${numero}/eventos`, { metodo: 'POST', corpo: { evento: nome } }),
        onSuccess: () => {
            void fila.invalidateQueries({ queryKey: chave })
            void fila.invalidateQueries({ queryKey: ['fila', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    if (!data) return <Vazio>Chamado não encontrado.</Vazio>

    const { chamado, mensagens, eventos, anexos } = data
    const trabalhando = responder.isPending || evento.isPending

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <section>
                <header className="mb-4">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-tinta-fraca">{chamado.numero}</span>
                        <Selo>{chamado.status}</Selo>
                        <Selo>{chamado.prioridade}</Selo>
                    </div>
                    <h1 className="mt-1 text-lg font-semibold">{chamado.assunto}</h1>
                </header>

                <ol className="space-y-3">
                    {mensagens.map((m) => (
                        <li
                            key={m.id}
                            className={`rounded-md border p-3 text-sm ${
                                m.visibilidade === 'INTERNA'
                                    ? 'border-atencao/40 bg-atencao/5'
                                    : 'border-borda bg-white'
                            }`}
                        >
                            <div className="mb-1 flex items-center gap-2 text-xs text-tinta-fraca">
                                <strong className="font-medium text-tinta">{m.autor.toLowerCase()}</strong>
                                {m.visibilidade === 'INTERNA' && (
                                    <span className="font-medium text-atencao">nota interna</span>
                                )}
                                {m.rascunho && <span className="font-medium text-destaque">rascunho</span>}
                                <span>· {m.origem.toLowerCase()}</span>
                                <Quando iso={m.criadoEm} />
                            </div>
                            <p className="whitespace-pre-wrap">{m.corpo}</p>
                        </li>
                    ))}
                </ol>

                <div className="mt-5 space-y-2">
                    <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        rows={4}
                        placeholder="Escreva a resposta ou a nota…"
                        className="w-full rounded-md border border-borda bg-white px-3 py-2 text-sm outline-none focus:border-destaque"
                    />
                    {erro !== null && <Aviso>{erro}</Aviso>}
                    <div className="flex flex-wrap gap-2">
                        <Botao
                            desabilitado={texto.trim() === '' || trabalhando}
                            onClick={() => responder.mutate({ corpo: texto, visibilidade: 'PUBLICA' })}
                        >
                            Responder ao cliente
                        </Botao>
                        <Botao
                            variante="leve"
                            desabilitado={texto.trim() === '' || trabalhando}
                            onClick={() => responder.mutate({ corpo: texto, visibilidade: 'INTERNA' })}
                        >
                            Nota interna
                        </Botao>
                    </div>
                </div>
            </section>

            <aside className="space-y-5 text-sm">
                <div>
                    <h2 className="mb-2 text-xs font-medium text-tinta-fraca">Ações</h2>
                    <div className="flex flex-wrap gap-2">
                        {chamado.status === 'NOVO' && (
                            <Botao variante="leve" desabilitado={trabalhando} onClick={() => evento.mutate('assumir')}>
                                Assumir
                            </Botao>
                        )}
                        {chamado.status !== 'RESOLVIDO' && chamado.status !== 'FECHADO' && (
                            <>
                                <Botao variante="leve" desabilitado={trabalhando} onClick={() => evento.mutate('escalar_engenharia')}>
                                    Escalar
                                </Botao>
                                <Botao variante="leve" desabilitado={trabalhando} onClick={() => evento.mutate('resolver')}>
                                    Resolver
                                </Botao>
                            </>
                        )}
                        {chamado.status === 'RESOLVIDO' && (
                            <Botao variante="leve" desabilitado={trabalhando} onClick={() => evento.mutate('fechar')}>
                                Fechar
                            </Botao>
                        )}
                    </div>
                </div>

                {chamado.contexto !== null && (
                    <div>
                        <h2 className="mb-2 text-xs font-medium text-tinta-fraca">
                            Contexto capturado
                        </h2>
                        <dl className="space-y-1 text-xs">
                            {Object.entries(chamado.contexto).map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                    <dt className="shrink-0 text-tinta-fraca">{k}</dt>
                                    <dd className="truncate font-mono">{String(v)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}

                {anexos.length > 0 && (
                    <div>
                        <h2 className="mb-2 text-xs font-medium text-tinta-fraca">Anexos</h2>
                        <ul className="space-y-1 text-xs">
                            {anexos.map((a) => (
                                <li key={a.chave} className="truncate">{a.nome}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div>
                    <h2 className="mb-2 text-xs font-medium text-tinta-fraca">
                        Trilha de auditoria ({eventos.length})
                    </h2>
                    <ol className="space-y-1 text-xs text-tinta-fraca">
                        {eventos.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-baseline gap-1">
                                <span className="font-medium text-tinta">{e.evento}</span>
                                <span className="font-mono">{e.ator}</span>
                                <Quando iso={e.criadoEm} />
                            </li>
                        ))}
                    </ol>
                </div>
            </aside>
        </div>
    )
}
