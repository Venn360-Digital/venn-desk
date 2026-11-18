import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { api, type Atendimento, type ChamadoCompleto } from '../api.ts'
import { Aviso, Botao, Quando, Selo, Vazio } from '../componentes/ui.tsx'
import { SeloDeSla } from '../componentes/sla.tsx'
import { Sparkles } from 'lucide-react'
import type { Mensagem } from '../api.ts'

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
export function Chamado({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const { app, numero } = useParams<{ app: string; numero: string }>()
    const fila = useQueryClient()
    const [texto, setTexto] = useState('')
    const [erro, setErro] = useState<string | null>(null)
    const [atendimento, setAtendimento] = useState<Atendimento | null>(null)

    const chave = ['chamado', app, numero]
    const { data, isPending } = useQuery({
        queryKey: chave,
        queryFn: () => api<ChamadoCompleto>(`/app/${app}/chamados/${numero}`),
    })

    const responder = useMutation({
        mutationFn: (v: { corpo: string; visibilidade: 'PUBLICA' | 'INTERNA' }) =>
            api(`/app/${app}/chamados/${numero}/mensagens`, { metodo: 'POST', corpo: v }),
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
            api(`/app/${app}/chamados/${numero}/eventos`, { metodo: 'POST', corpo: { evento: nome } }),
        onSuccess: () => {
            void fila.invalidateQueries({ queryKey: chave })
            void fila.invalidateQueries({ queryKey: ['fila', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    /**
     * O atendimento pela IA é uma mutação demorada — o modelo lê, busca,
     * classifica e responde, e isso leva segundos. Por isso o botão mostra que
     * está trabalhando e o resultado aparece embaixo, em vez de a tela só
     * recarregar sozinha: quem apertou precisa saber O QUE a IA fez.
     */
    const decidir = useMutation({
        mutationFn: (v: { id: string; acao: 'enviar' | 'descartar'; corpo?: string }) =>
            api(`/app/${app}/chamados/${numero}/rascunhos/${v.id}`, {
                metodo: 'POST',
                corpo: { acao: v.acao, ...(v.corpo === undefined ? {} : { corpo: v.corpo }) },
            }),
        onSuccess: () => {
            setErro(null)
            void fila.invalidateQueries({ queryKey: chave })
            void fila.invalidateQueries({ queryKey: ['fila'] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    const atender = useMutation({
        mutationFn: () =>
            api<Atendimento>(`/app/${app}/chamados/${numero}/atender`, { metodo: 'POST' }),
        onSuccess: (r) => {
            setAtendimento(r)
            setErro(null)
            void fila.invalidateQueries({ queryKey: chave })
            void fila.invalidateQueries({ queryKey: ['fila'] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    if (!data) return <Vazio>Chamado não encontrado.</Vazio>

    const { chamado, mensagens, eventos, anexos, app: produto, empresa, sla } = data
    const trabalhando = responder.isPending || evento.isPending

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <section>
                <header className="mb-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-tinta-fraca">{chamado.numero}</span>
                        <Selo>{chamado.status}</Selo>
                        <Selo>{chamado.prioridade}</Selo>
                        <SeloDeSla sla={sla} />
                    </div>
                    <h1 className="mt-1 text-lg font-semibold">{chamado.assunto}</h1>
                    {/*
                      De quem é e em qual produto — a mesma informação que a
                      fila mostra. Sem isto, clicar numa linha PERDIA contexto.
                    */}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-tinta-fraca">
                        <span>{produto?.nome}</span>
                        {empresa ? (
                            <>
                                <span aria-hidden>·</span>
                                <span className="text-tinta">{empresa.nome}</span>
                                {empresa.plano ? <span>({empresa.plano})</span> : null}
                            </>
                        ) : null}
                        {empresa?.conta ? (
                            <>
                                <span aria-hidden>·</span>
                                <span>conta {empresa.conta.nome}</span>
                            </>
                        ) : null}
                    </p>
                </header>

                <ol className="space-y-3">
                    {mensagens.map((m) =>
                        m.rascunho && m.descartadoEm === null ? (
                            <RascunhoPendente
                                key={m.id}
                                mensagem={m}
                                trabalhando={trabalhando || decidir.isPending}
                                aoDecidir={(v) => decidir.mutate({ id: m.id, ...v })}
                            />
                        ) : (
                        <li
                            key={m.id}
                            /**
                             * `bg-superficie`, não `bg-white`.
                             *
                             * Com a marca, o Console tem tema escuro — e
                             * `bg-white` fixo virava caixa branca em página
                             * preta. A nota interna usa o par pronto da marca
                             * (`atencao-fundo`) pela mesma razão: 5% de uma cor
                             * clara sobre fundo escuro dá cinza lavado.
                             */
                            className={`rounded-sm border p-3 text-sm ${
                                m.visibilidade === 'INTERNA'
                                    ? 'border-atencao/40 bg-atencao-fundo'
                                    : 'border-borda bg-superficie'
                            }`}
                        >
                            <div className="mb-1 flex items-center gap-2 text-xs text-tinta-fraca">
                                <strong className="font-medium text-tinta">{m.autor.toLowerCase()}</strong>
                                {m.visibilidade === 'INTERNA' && (
                                    <span className="font-medium text-atencao">nota interna</span>
                                )}
                                {m.descartadoEm !== null && (
                                    <span className="font-medium text-tinta-sutil">
                                        rascunho descartado
                                    </span>
                                )}
                                <span>· {m.origem.toLowerCase()}</span>
                                <Quando iso={m.criadoEm} />
                            </div>
                            <p
                                className={`whitespace-pre-wrap ${
                                    m.descartadoEm === null ? '' : 'text-tinta-sutil line-through'
                                }`}
                            >
                                {m.corpo}
                            </p>
                        </li>
                        )
                    )}
                </ol>

                <div className="mt-5 space-y-2">
                    <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        rows={4}
                        placeholder="Escreva a resposta ou a nota…"
                        className="w-full rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
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

                {papel !== 'AGENTE' ? (
                    <div>
                        <h2 className="mb-2 text-xs font-medium text-tinta-fraca">
                            Atendimento pela IA
                        </h2>
                        <Botao
                            variante="leve"
                            desabilitado={atender.isPending || trabalhando}
                            onClick={() => atender.mutate()}
                        >
                            <span className="flex items-center gap-1.5">
                                <Sparkles size={13} aria-hidden />
                                {atender.isPending ? 'Atendendo…' : 'Atender com a IA'}
                            </span>
                        </Botao>
                        {atendimento !== null ? <Resultado atendimento={atendimento} /> : null}
                    </div>
                ) : null}

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

/**
 * O que a IA fez, depois de fazer.
 *
 * **A conclusão NÃO é a resposta ao cliente.** O que chegou a ele está na linha
 * do tempo, gravado por `responder_usuario` — e em modo sombra está lá como
 * rascunho. Este texto é o raciocínio do modelo, e a tela diz isso, porque a
 * confusão entre os dois é a mais cara que este desenho permite.
 */
function Resultado({ atendimento }: { atendimento: Atendimento }) {
    const tokens = atendimento.consumo.tokensDeEntrada + atendimento.consumo.tokensDeSaida

    return (
        <div className="mt-3 space-y-2 rounded-sm border border-borda bg-superficie p-3 text-xs">
            {atendimento.fim === 'teto' ? (
                <p className="font-medium text-atencao">
                    Parou no teto de gasto. O chamado precisa de uma pessoa.
                </p>
            ) : (
                <p className="font-medium text-calmo">Atendimento concluído.</p>
            )}

            <p className="text-tinta-fraca">
                {atendimento.consumo.passos} passo
                {atendimento.consumo.passos === 1 ? '' : 's'} · {tokens.toLocaleString('pt-BR')}{' '}
                tokens
            </p>

            {atendimento.chamadas.length > 0 ? (
                <p className="text-tinta-fraca">
                    Ferramentas: <span className="font-mono">{atendimento.chamadas.join(' → ')}</span>
                </p>
            ) : (
                <p className="text-tinta-sutil">Não chamou nenhuma ferramenta.</p>
            )}

            {atendimento.conclusao.trim() !== '' ? (
                <div>
                    <p className="mb-1 text-tinta-sutil">
                        Conclusão da IA — isto NÃO foi enviado ao cliente:
                    </p>
                    <p className="whitespace-pre-wrap text-tinta-fraca">
                        {atendimento.conclusao}
                    </p>
                </div>
            ) : null}
        </div>
    )
}

/**
 * O rascunho do modo sombra, como DECISÃO pendente.
 *
 * Ele não é desenhado como mensagem de propósito: uma mensagem na linha do
 * tempo parece coisa que já aconteceu, e este texto não chegou a ninguém. Com
 * moldura própria, caixa editável e três botões, fica claro que alguém precisa
 * agir — e foi a falta disso que deixou uma cliente reabrindo o mesmo chamado
 * três vezes, achando que ninguém respondia.
 *
 * O texto já vem na caixa, editável. "Editar" não é um modo separado: é
 * escrever por cima e enviar. O sistema compara com o original para saber se
 * houve edição — a medida que decide quando o app sai do modo sombra.
 */
function RascunhoPendente({
    mensagem,
    trabalhando,
    aoDecidir,
}: {
    mensagem: Mensagem
    trabalhando: boolean
    aoDecidir: (v: { acao: 'enviar' | 'descartar'; corpo?: string }) => void
}) {
    const [texto, setTexto] = useState(mensagem.corpo)
    const mexeu = texto.trim() !== mensagem.corpo.trim()

    return (
        <li className="rounded-sm border border-destaque/50 bg-destaque-suave/40 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <Sparkles size={13} className="text-destaque" aria-hidden />
                <strong className="font-medium text-destaque">
                    Rascunho da IA — ainda não enviado
                </strong>
                <Quando iso={mensagem.criadoEm} />
            </div>

            <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={Math.min(14, texto.split('\n').length + 2)}
                className="w-full rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <Botao
                    desabilitado={trabalhando || texto.trim() === ''}
                    onClick={() => aoDecidir({ acao: 'enviar', corpo: texto })}
                >
                    {mexeu ? 'Enviar com as minhas alterações' : 'Enviar ao cliente'}
                </Botao>
                <Botao
                    variante="perigo"
                    desabilitado={trabalhando}
                    onClick={() => aoDecidir({ acao: 'descartar' })}
                >
                    Descartar
                </Botao>
                {mexeu ? (
                    <span className="text-xs text-tinta-fraca">
                        editado — isto conta contra a saída do modo sombra
                    </span>
                ) : null}
            </div>
        </li>
    )
}
