import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type AppCadastrado } from '../api.ts'
import { Botao, Selo, Vazio } from '../componentes/ui.tsx'

/**
 * O cadastro de apps. Na Fase 1 ele lê e alterna o modo sombra; incluir app
 * novo pela tela entra na Fase 8, junto com o roteiro de inclusão — hoje quem
 * cadastra é a semente, e a chave pública vem da chave real que o app gera na
 * Fase 2.
 *
 * O modo sombra está aqui porque é a chave que decide se a resposta da IA sai
 * sozinha. Ela precisa ser visível e desligável numa tela, não num banco.
 */
export function Apps({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const fila = useQueryClient()
    const { data, isPending } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
    })

    const alternar = useMutation({
        mutationFn: (v: { slug: string; modoSombra: boolean }) =>
            api(`/apps/${v.slug}`, { metodo: 'PATCH', corpo: { modoSombra: v.modoSombra } }),
        onSuccess: () => void fila.invalidateQueries({ queryKey: ['apps'] }),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    const apps = data?.apps ?? []

    return (
        <div className="space-y-3">
            {apps.map((app) => (
                <article key={app.slug} className="rounded-md border border-borda bg-white p-4">
                    <header className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{app.nome}</h2>
                        <span className="font-mono text-xs text-tinta-fraca">{app.prefixo}</span>
                        {app.modoSombra ? <Selo>ALTA</Selo> : <Selo>RESOLVIDO</Selo>}
                        <span className="text-xs text-tinta-fraca">
                            {app.modoSombra ? 'modo sombra ligado' : 'envio automático'}
                        </span>
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
                            <dd className="truncate font-mono">{app.repositorio ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="text-tinta-fraca">canais</dt>
                            <dd className="truncate font-mono">
                                {[app.canalSuporte, app.canalEngenharia].filter(Boolean).join(' · ') || '—'}
                            </dd>
                        </div>
                    </dl>

                    {papel !== 'AGENTE' && (
                        <div className="mt-3">
                            <Botao
                                variante="leve"
                                desabilitado={alternar.isPending}
                                onClick={() => alternar.mutate({ slug: app.slug, modoSombra: !app.modoSombra })}
                            >
                                {app.modoSombra ? 'Ligar envio automático' : 'Voltar ao modo sombra'}
                            </Botao>
                        </div>
                    )}
                </article>
            ))}
        </div>
    )
}
