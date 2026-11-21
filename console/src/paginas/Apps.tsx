import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type AppCadastrado } from '../api.ts'
import { Aviso, Botao, Campo, Vazio } from '../componentes/ui.tsx'

/**
 * O cadastro de apps. Na Fase 1 ele lê e alterna o modo sombra; incluir app
 * novo pela tela entra na Fase 8, junto com o roteiro de inclusão — hoje quem
 * cadastra é a semente, e a chave pública vem da chave real que o app gera na
 * Fase 2.
 *
 * O modo sombra está aqui porque é a chave que decide se a resposta da IA sai
 * sozinha. Ela precisa ser visível e desligável numa tela, não num banco.
 */
/** Uma chave ligada/desligada, legível de relance. */
function Chave({ ligada, rotulo }: { ligada: boolean; rotulo: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-[11px] font-medium ${
                ligada ? 'bg-calmo-fundo text-calmo' : 'bg-superficie-3 text-tinta-fraca'
            }`}
        >
            <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                    ligada ? 'bg-calmo' : 'bg-tinta-sutil'
                }`}
            />
            {rotulo}
        </span>
    )
}

export function Apps({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const fila = useQueryClient()
    const { data, isPending } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
    })

    const alternar = useMutation({
        mutationFn: (v: { slug: string; modoSombra?: boolean; atendimentoAutomatico?: boolean }) =>
            api(`/apps/${v.slug}`, {
                metodo: 'PATCH',
                corpo: {
                    ...(v.modoSombra === undefined ? {} : { modoSombra: v.modoSombra }),
                    ...(v.atendimentoAutomatico === undefined
                        ? {}
                        : { atendimentoAutomatico: v.atendimentoAutomatico }),
                },
            }),
        onSuccess: () => void fila.invalidateQueries({ queryKey: ['apps'] }),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    const apps = data?.apps ?? []

    return (
        <div className="space-y-3">
            {apps.map((app) => (
                <article key={app.slug} className="rounded-sm border border-borda bg-superficie p-4">
                    <header className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{app.nome}</h2>
                        <span className="font-mono text-xs text-tinta-fraca">{app.prefixo}</span>
                        <Chave
                            ligada={app.atendimentoAutomatico}
                            rotulo={
                                app.atendimentoAutomatico
                                    ? 'IA atende sozinha'
                                    : 'IA só por botão'
                            }
                        />
                        <Chave
                            ligada={!app.modoSombra}
                            rotulo={app.modoSombra ? 'resposta em rascunho' : 'resposta sai direto'}
                        />
                    </header>

                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        <div className="flex gap-2">
                            <dt className="text-tinta-fraca">próximo chamado</dt>
                            <dd className="font-mono">
                                {app.prefixo}-{String(app.proximoNumero).padStart(4, '0')}
                            </dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="text-tinta-fraca">chave do token</dt>
                            <dd className={app.chaveCadastrada ? '' : 'text-urgente'}>
                                {app.chaveCadastrada ? 'cadastrada' : 'pendente'}
                            </dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="text-tinta-fraca">repositório</dt>
                            <dd className="truncate font-mono">
                                {app.repositorio ?? '—'}
                                {app.pastaNoRepositorio !== null ? ` · ${app.pastaNoRepositorio}` : ''}
                            </dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="text-tinta-fraca">canais</dt>
                            <dd className="truncate font-mono">
                                {[app.canalSuporte, app.canalEngenharia].filter(Boolean).join(' · ') || '—'}
                            </dd>
                        </div>
                    </dl>

                    {papel !== 'AGENTE' ? (
                        <>
                            <Repositorio app={app} />
                            <CanaisDoSlack app={app} />
                        </>
                    ) : null}

                    {papel !== 'AGENTE' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Botao
                                variante="leve"
                                desabilitado={alternar.isPending}
                                onClick={() =>
                                    alternar.mutate({
                                        slug: app.slug,
                                        atendimentoAutomatico: !app.atendimentoAutomatico,
                                    })
                                }
                            >
                                {app.atendimentoAutomatico
                                    ? 'Desligar atendimento automático'
                                    : 'Ligar atendimento automático'}
                            </Botao>
                            <Botao
                                variante="leve"
                                desabilitado={alternar.isPending}
                                onClick={() =>
                                    alternar.mutate({ slug: app.slug, modoSombra: !app.modoSombra })
                                }
                            >
                                {app.modoSombra
                                    ? 'Deixar a resposta sair sem revisão'
                                    : 'Voltar ao modo sombra'}
                            </Botao>
                        </div>
                    )}

                    {/*
                      As duas chaves respondem perguntas diferentes, e a ordem
                      recomendada é esta: ligar o atendimento com o modo sombra
                      ainda ligado, ver os rascunhos, e só então deixar a
                      resposta sair. A tela diz isso para ninguém ligar as duas
                      no mesmo clique sem pensar.
                    */}
                    {papel !== 'AGENTE' && app.atendimentoAutomatico && !app.modoSombra ? (
                        <p className="mt-2 text-xs text-atencao">
                            A IA atende e responde sem revisão humana neste app.
                        </p>
                    ) : null}
                </article>
            ))}
        </div>
    )
}

/**
 * O cadastro do repositório e da pasta do app — o que liga a base viva.
 *
 * Dois campos e um botão, dentro do cartão do app. Os três apps moram no mesmo
 * monorepo (`Venn360-Digital/venn-saas`); o que muda é a pasta
 * (`apps/odontobox360`). Sem os dois preenchidos a sincronização não roda, e a
 * tela da Base diz isso e manda para cá.
 */
/**
 * Os canais do Slack do app (seção 8).
 *
 * Dois campos, o id do canal e não o nome: o nome muda quando alguém renomeia
 * o canal, e a ponte perderia o vínculo em silêncio. O id (`C…`) fica em
 * "Ver detalhes do canal", no fim.
 *
 * Sem o canal de suporte preenchido, a abertura de chamado não é espelhada e
 * ninguém é avisado disso — é o comportamento certo, porque um app pode
 * deliberadamente não usar Slack.
 */
function CanaisDoSlack({ app }: { app: AppCadastrado }) {
    const fila = useQueryClient()
    const [suporte, setSuporte] = useState(app.canalSuporte ?? '')
    const [engenharia, setEngenharia] = useState(app.canalEngenharia ?? '')
    const mudou = suporte !== (app.canalSuporte ?? '') || engenharia !== (app.canalEngenharia ?? '')

    const salvar = useMutation({
        mutationFn: () =>
            api(`/apps/${app.slug}`, {
                metodo: 'PATCH',
                corpo: {
                    canalSuporte: suporte.trim() === '' ? null : suporte.trim(),
                    canalEngenharia: engenharia.trim() === '' ? null : engenharia.trim(),
                },
            }),
        onSuccess: () => void fila.invalidateQueries({ queryKey: ['apps'] }),
    })

    return (
        <form
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
                e.preventDefault()
                salvar.mutate()
            }}
        >
            <Campo rotulo="Canal de suporte (id, C…)" valor={suporte} onChange={setSuporte} />
            <Campo rotulo="Canal de engenharia (id, C…)" valor={engenharia} onChange={setEngenharia} />
            <Botao tipo="submit" variante="leve" desabilitado={!mudou || salvar.isPending}>
                Salvar
            </Botao>
            {salvar.isError ? (
                <div className="sm:col-span-3">
                    <Aviso>{(salvar.error as Error).message}</Aviso>
                </div>
            ) : null}
        </form>
    )
}

function Repositorio({ app }: { app: AppCadastrado }) {
    const fila = useQueryClient()
    const [repositorio, setRepositorio] = useState(app.repositorio ?? '')
    const [pasta, setPasta] = useState(app.pastaNoRepositorio ?? '')
    const mudou = repositorio !== (app.repositorio ?? '') || pasta !== (app.pastaNoRepositorio ?? '')

    const salvar = useMutation({
        mutationFn: () =>
            api(`/apps/${app.slug}`, {
                metodo: 'PATCH',
                corpo: {
                    repositorio: repositorio.trim() === '' ? null : repositorio.trim(),
                    pastaNoRepositorio: pasta.trim() === '' ? null : pasta.trim().replace(/^\/+|\/+$/g, ''),
                },
            }),
        onSuccess: () => void fila.invalidateQueries({ queryKey: ['apps'] }),
    })

    return (
        <form
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
                e.preventDefault()
                salvar.mutate()
            }}
        >
            <Campo rotulo="Repositório (dono/nome)" valor={repositorio} onChange={setRepositorio} />
            <Campo rotulo="Pasta do app no repositório" valor={pasta} onChange={setPasta} />
            <Botao tipo="submit" variante="leve" desabilitado={!mudou || salvar.isPending}>
                Salvar
            </Botao>
            {salvar.isError ? (
                <div className="sm:col-span-3">
                    <Aviso>{(salvar.error as Error).message}</Aviso>
                </div>
            ) : null}
        </form>
    )
}
