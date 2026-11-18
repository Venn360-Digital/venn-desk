import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy, KeyRound } from 'lucide-react'

import { api, type AppCadastrado, type ChaveDoMcp, type SegredoEmitido } from '../api.ts'
import { Aviso, Botao, Campo, Quando, Vazio } from '../componentes/ui.tsx'

/**
 * As credenciais do servidor MCP, por app.
 *
 * **A tela existe principalmente para o momento em que a chave aparece.** Ela é
 * mostrada UMA vez — depois, só o hash fica guardado — e uma pessoa que fechar
 * a aba antes de copiar precisa emitir outra. Por isso o segredo não aparece
 * numa linha da tabela junto com o resto: ele toma um bloco próprio, com aviso
 * e botão de copiar, e some assim que a tela é recarregada.
 *
 * O resto é lista e revogação. Nenhuma das duas revela nada: prefixo, nome,
 * escopo e quando foi usada pela última vez.
 */

const EXPLICACAO: Record<ChaveDoMcp['escopo'], string> = {
    SUPORTE: 'Atende: lê, classifica, responde e escala. Sem ferramentas de engenharia.',
    ENGENHARIA: 'Tudo do suporte, mais abrir defeito e ligar incidentes.',
}

/**
 * O escopo tem selo próprio, e não o de prioridade.
 *
 * Eu havia reaproveitado o `Selo` passando `NORMAL`/`ALTA` só para herdar as
 * cores — e ele imprime o RÓTULO daquilo, então a coluna dizia "normal
 * suporte". Reusar um componente pelo visual, contra o significado dele, é
 * exatamente como uma tela passa a mentir.
 */
function SeloDoEscopo({ escopo }: { escopo: ChaveDoMcp['escopo'] }) {
    const eEngenharia = escopo === 'ENGENHARIA'

    return (
        <span
            title={EXPLICACAO[escopo]}
            className={`inline-block rounded-xs px-1.5 py-0.5 text-[11px] font-medium ${
                eEngenharia ? 'bg-atencao-fundo text-atencao' : 'bg-superficie-3 text-tinta-fraca'
            }`}
        >
            {eEngenharia ? 'engenharia' : 'suporte'}
        </span>
    )
}

export function Credenciais({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const { app: daRota } = useParams<{ app: string }>()
    const fila = useQueryClient()
    const [erro, setErro] = useState<string | null>(null)
    const [emitido, setEmitido] = useState<SegredoEmitido | null>(null)

    const { data: cadastro } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
        staleTime: 5 * 60_000,
    })
    const apps = cadastro?.apps ?? []
    const app = daRota ?? apps[0]?.slug

    const { data, isPending } = useQuery({
        queryKey: ['mcp', app],
        queryFn: () => api<{ chaves: ChaveDoMcp[] }>(`/app/${app}/mcp`),
        enabled: app !== undefined,
    })

    const emitir = useMutation({
        mutationFn: (v: { nome: string; escopo: ChaveDoMcp['escopo'] }) =>
            api<SegredoEmitido>(`/app/${app}/mcp`, { metodo: 'POST', corpo: v }),
        onSuccess: (resposta) => {
            setEmitido(resposta)
            setErro(null)
            void fila.invalidateQueries({ queryKey: ['mcp', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    const revogar = useMutation({
        mutationFn: (id: string) => api(`/app/${app}/mcp/${id}`, { metodo: 'DELETE' }),
        onSuccess: () => void fila.invalidateQueries({ queryKey: ['mcp', app] }),
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    const chaves = data?.chaves ?? []
    const podeEmitir = papel === 'ADMIN'

    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap gap-1">
                {apps.map((a) => (
                    <Link
                        key={a.slug}
                        to={`/credenciais/${a.slug}`}
                        className={
                            a.slug === app
                                ? 'rounded-sm bg-tinta px-3 py-1.5 text-xs font-medium text-fundo'
                                : 'rounded-sm border border-borda bg-superficie px-3 py-1.5 text-xs text-tinta-fraca transition hover:text-tinta'
                        }
                    >
                        {a.nome}
                    </Link>
                ))}
            </nav>

            <p className="text-xs text-tinta-fraca">
                Credenciais do servidor MCP. Cada chave vale para <strong>um app</strong> e
                para <strong>um escopo</strong> — a do Odontobox não alcança chamados do
                Conecta, e a de suporte não enxerga as ferramentas de engenharia.
            </p>

            {erro !== null ? <Aviso>{erro}</Aviso> : null}
            {emitido !== null ? <Segredo emitido={emitido} aoFechar={() => setEmitido(null)} /> : null}

            {podeEmitir ? <Emissao emitindo={emitir.isPending} aoEmitir={(v) => emitir.mutate(v)} /> : null}

            {chaves.length === 0 ? (
                <Vazio>Nenhuma credencial emitida para este app.</Vazio>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-borda text-left text-xs text-tinta-sutil">
                            <th className="py-2 font-medium">Nome</th>
                            <th className="py-2 font-medium">Escopo</th>
                            <th className="py-2 font-medium">Prefixo</th>
                            <th className="py-2 font-medium">Último uso</th>
                            <th className="py-2 font-medium">Estado</th>
                            {papel !== 'AGENTE' ? <th /> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {chaves.map((k) => (
                            <tr key={k.id} className="border-b border-borda/60">
                                <td className="py-2">{k.nome}</td>
                                <td className="py-2">
                                    <SeloDoEscopo escopo={k.escopo} />
                                </td>
                                <td className="py-2 font-mono text-xs text-tinta-fraca">
                                    {k.prefixo}…
                                </td>
                                <td className="py-2">
                                    {k.usadoEm === null ? (
                                        <span className="text-xs text-tinta-sutil">nunca usada</span>
                                    ) : (
                                        <Quando iso={k.usadoEm} />
                                    )}
                                </td>
                                <td className="py-2 text-xs">
                                    {k.revogadoEm === null ? (
                                        <span className="text-calmo">ativa</span>
                                    ) : (
                                        <span className="text-tinta-sutil">revogada</span>
                                    )}
                                </td>
                                {papel !== 'AGENTE' ? (
                                    <td className="py-2 text-right">
                                        {k.revogadoEm === null ? (
                                            <button
                                                onClick={() => revogar.mutate(k.id)}
                                                className="text-xs text-urgente hover:underline"
                                            >
                                                revogar
                                            </button>
                                        ) : null}
                                    </td>
                                ) : null}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {podeEmitir ? null : (
                <p className="text-xs text-tinta-fraca">
                    Só admin emite credencial: ela dá a um modelo leitura e escrita em todos
                    os chamados do app.
                </p>
            )}
        </div>
    )
}

/**
 * O bloco do segredo.
 *
 * Ele some ao recarregar a tela, e o texto diz isso antes de a pessoa descobrir
 * sozinha. O botão de copiar existe porque selecionar uma chave de 50
 * caracteres com o mouse é onde ela se perde pela metade.
 */
function Segredo({ emitido, aoFechar }: { emitido: SegredoEmitido; aoFechar: () => void }) {
    const [copiado, setCopiado] = useState(false)

    async function copiar() {
        try {
            await navigator.clipboard.writeText(emitido.segredo)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 2500)
        } catch {
            /// Sem permissão de área de transferência: o valor está na tela e
            /// pode ser selecionado à mão.
        }
    }

    return (
        <div className="rounded-sm border border-atencao/40 bg-atencao-fundo p-4">
            <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-atencao" aria-hidden />
                <strong className="text-sm text-atencao">{emitido.aviso}</strong>
            </div>
            <p className="mt-1 text-xs text-atencao/90">
                Guarde no cofre agora. Ao recarregar esta tela ela desaparece, e emitir outra
                é o único caminho.
            </p>

            <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs border border-borda bg-superficie px-2 py-1.5 font-mono text-xs">
                    {emitido.segredo}
                </code>
                <Botao variante="leve" onClick={() => void copiar()}>
                    {copiado ? (
                        <span className="flex items-center gap-1">
                            <Check size={13} aria-hidden /> copiado
                        </span>
                    ) : (
                        <span className="flex items-center gap-1">
                            <Copy size={13} aria-hidden /> copiar
                        </span>
                    )}
                </Botao>
                <Botao variante="leve" onClick={aoFechar}>
                    já guardei
                </Botao>
            </div>
        </div>
    )
}

function Emissao({
    emitindo,
    aoEmitir,
}: {
    emitindo: boolean
    aoEmitir: (v: { nome: string; escopo: ChaveDoMcp['escopo'] }) => void
}) {
    const [nome, setNome] = useState('')
    const [escopo, setEscopo] = useState<ChaveDoMcp['escopo']>('SUPORTE')

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                aoEmitir({ nome, escopo })
                setNome('')
            }}
            className="flex flex-wrap items-end gap-3 rounded-sm border border-borda bg-superficie p-4"
        >
            <div className="min-w-48 flex-1">
                <Campo
                    rotulo="Para quem é esta chave"
                    valor={nome}
                    onChange={setNome}
                    requerido
                />
            </div>

            <label className="flex flex-col gap-1">
                <span className="mb-1 block text-xs font-medium text-tinta-fraca">Escopo</span>
                <select
                    value={escopo}
                    onChange={(e) => setEscopo(e.target.value as ChaveDoMcp['escopo'])}
                    className="rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
                >
                    <option value="SUPORTE">suporte</option>
                    <option value="ENGENHARIA">engenharia</option>
                </select>
            </label>

            <Botao tipo="submit" desabilitado={emitindo || nome.trim().length < 3}>
                {emitindo ? 'Emitindo…' : 'Emitir credencial'}
            </Botao>

            <p className="w-full text-xs text-tinta-sutil">{EXPLICACAO[escopo]}</p>
        </form>
    )
}
