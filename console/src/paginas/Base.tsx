import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Globe, Plus } from 'lucide-react'

import {
    api,
    type AppCadastrado,
    type Artigo,
    type Divergencia,
    type Divergencias as DivergenciasDaApi,
    type OrigemDoArtigo,
    type ResumoDeConsultas,
    type StatusDoArtigo,
} from '../api.ts'
import { Sincronizacao } from '../componentes/Sincronizacao.tsx'
import { Aviso, Botao, Campo, Quando, Vazio } from '../componentes/ui.tsx'

/**
 * A base de conhecimento, por app.
 *
 * **Para que esta tela existe.** Sem artigo, o agente responde pelo que alguém
 * já perguntou: ele acha um chamado antigo e repete o que um atendente escreveu
 * numa terça-feira, com o acerto e o erro daquele dia. Com artigo, ele responde
 * pelo que a empresa decidiu que é a resposta certa — e a instrução manda
 * consultar a base ANTES dos chamados.
 *
 * **Publicar é um segundo ato.** O artigo nasce rascunho e só vira resposta
 * oficial por um clique deliberado: o que está aqui chega a cliente pela boca
 * da IA, e ninguém põe isso no ar de passagem.
 */

const RASCUNHO_VAZIO = { titulo: '', corpo: '', tags: '', global: false }

const CORES: Record<StatusDoArtigo, string> = {
    RASCUNHO: 'bg-superficie-3 text-tinta-fraca',
    PUBLICADO: 'bg-calmo-fundo text-calmo',
    ARQUIVADO: 'bg-superficie-3 text-tinta-sutil',
}

const ROTULOS: Record<StatusDoArtigo, string> = {
    RASCUNHO: 'rascunho',
    PUBLICADO: 'no ar',
    ARQUIVADO: 'arquivado',
}

/**
 * A origem, legível. "derivado" é o artigo que o repositório escreve e a
 * sincronização mantém; "sugerido" é o que o Desk propôs e espera aprovação.
 * Manual não tem selo: é o caso comum, e selo em tudo é selo em nada.
 */
const ORIGEM: Record<OrigemDoArtigo, { rotulo: string; cor: string } | null> = {
    MANUAL: null,
    DERIVADO: { rotulo: 'derivado', cor: 'bg-informe-fundo text-informe' },
    SUGERIDO: { rotulo: 'sugerido', cor: 'bg-atencao-fundo text-atencao' },
}

type FiltroDeOrigem = 'todos' | OrigemDoArtigo

export function Base({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const { app: daRota } = useParams<{ app: string }>()
    const fila = useQueryClient()
    const [erro, setErro] = useState<string | null>(null)
    const [editando, setEditando] = useState<string | null>(null)
    const [rascunho, setRascunho] = useState(RASCUNHO_VAZIO)
    /**
     * O editor nasce FECHADO.
     *
     * O trabalho principal desta tela é consultar o que já existe; escrever é o
     * eventual. Aberto por padrão, o formulário empurrava a tabela inteira para
     * fora da primeira tela — medido em 493px de altura, mais que o dobro da
     * lista com três artigos.
     */
    const [abertoParaEscrever, setAberto] = useState(false)
    const [filtro, setFiltro] = useState<FiltroDeOrigem>('todos')

    const { data: cadastro } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
        staleTime: 5 * 60_000,
    })
    const apps = cadastro?.apps ?? []
    const app = daRota ?? apps[0]?.slug

    const { data, isPending } = useQuery({
        queryKey: ['base', app],
        queryFn: () => api<{ artigos: Artigo[]; consultas: ResumoDeConsultas }>(`/app/${app}/base`),
        enabled: app !== undefined,
    })

    /// Trocar de app fecha o editor: continuar editando um artigo do app
    /// anterior salvaria no lugar errado sem avisar.
    useEffect(() => {
        setEditando(null)
        setRascunho(RASCUNHO_VAZIO)
        setAberto(false)
        setErro(null)
    }, [app])

    const recarregar = () => void fila.invalidateQueries({ queryKey: ['base', app] })

    const salvar = useMutation({
        mutationFn: async () => {
            const corpo = {
                titulo: rascunho.titulo,
                corpo: rascunho.corpo,
                tags: rascunho.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t !== ''),
                global: rascunho.global,
            }

            return editando === null
                ? api(`/app/${app}/base`, { metodo: 'POST', corpo })
                : api(`/app/${app}/base/${editando}`, { metodo: 'PUT', corpo })
        },
        onSuccess: () => {
            setErro(null)
            setEditando(null)
            setRascunho(RASCUNHO_VAZIO)
            setAberto(false)
            recarregar()
        },
        onError: (e: Error) => setErro(e.message),
    })

    const mudarStatus = useMutation({
        mutationFn: ({ id, status }: { id: string; status: StatusDoArtigo }) =>
            api(`/app/${app}/base/${id}/status`, { metodo: 'POST', corpo: { status } }),
        onSuccess: () => {
            setErro(null)
            recarregar()
        },
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending) return <Vazio>carregando…</Vazio>

    const todos = data?.artigos ?? []
    const artigos = filtro === 'todos' ? todos : todos.filter((a) => a.origem === filtro)
    const contagem = (o: OrigemDoArtigo) => todos.filter((a) => a.origem === o).length
    const consultas = data?.consultas
    const podeEditar = papel !== 'AGENTE'
    const abrir = (artigo: Artigo) => {
        setEditando(artigo.id)
        setAberto(true)
        setRascunho({
            titulo: artigo.titulo,
            corpo: artigo.corpo,
            tags: artigo.tags.join(', '),
            global: artigo.global,
        })
    }

    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap gap-1">
                {apps.map((a) => (
                    <Link
                        key={a.slug}
                        to={`/base/${a.slug}`}
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
                O agente consulta a base <strong className="text-tinta">antes</strong> dos
                chamados antigos. Só o que está no ar chega a cliente.
            </p>

            {app !== undefined ? <Sincronizacao app={app} podeEditar={podeEditar} /> : null}

            {erro !== null ? <Aviso>{erro}</Aviso> : null}

            <Divergencias />

            {consultas !== undefined && consultas.lacunas.length > 0 ? (
                <Lacunas consultas={consultas} aoEscrever={podeEditar ? (exemplo) => {
                    /// Começar o artigo a partir da pergunta: o título nasce
                    /// com as palavras que alguém usou, que são as que a busca
                    /// precisa achar depois.
                    setEditando(null)
                    setRascunho({ ...RASCUNHO_VAZIO, titulo: exemplo })
                    setAberto(true)
                } : undefined} />
            ) : null}

            {podeEditar && abertoParaEscrever ? (
                <Editor
                    rascunho={rascunho}
                    setRascunho={setRascunho}
                    editando={editando}
                    salvando={salvar.isPending}
                    onSalvar={() => salvar.mutate()}
                    onCancelar={() => {
                        setEditando(null)
                        setRascunho(RASCUNHO_VAZIO)
                        setAberto(false)
                    }}
                />
            ) : podeEditar ? (
                <Botao
                    variante="leve"
                    onClick={() => {
                        setEditando(null)
                        setRascunho(RASCUNHO_VAZIO)
                        setAberto(true)
                    }}
                >
                    Artigo novo
                </Botao>
            ) : (
                <p className="text-xs text-tinta-fraca">
                    Agente lê a base; gestor e admin escrevem.
                </p>
            )}

            {todos.length > 0 ? (
                <div className="flex flex-wrap gap-1 text-xs">
                    {(
                        [
                            ['todos', `todos (${todos.length})`],
                            ['DERIVADO', `derivados (${contagem('DERIVADO')})`],
                            ['MANUAL', `manuais (${contagem('MANUAL')})`],
                            ['SUGERIDO', `sugeridos (${contagem('SUGERIDO')})`],
                        ] as [FiltroDeOrigem, string][]
                    ).map(([valor, rotulo]) => (
                        <button
                            key={valor}
                            type="button"
                            onClick={() => setFiltro(valor)}
                            className={
                                filtro === valor
                                    ? 'rounded-sm border border-destaque px-2.5 py-1 text-destaque'
                                    : 'rounded-sm border border-borda px-2.5 py-1 text-tinta-fraca transition hover:text-tinta'
                            }
                        >
                            {rotulo}
                        </button>
                    ))}
                </div>
            ) : null}

            {todos.length === 0 ? (
                <Vazio>
                    Nenhum artigo ainda. Cadastre o repositório e a pasta do app e sincronize —
                    ou escreva um à mão.
                </Vazio>
            ) : artigos.length === 0 ? (
                <Vazio>Nenhum artigo com essa origem.</Vazio>
            ) : (
                <div className="overflow-x-auto rounded-sm border border-borda bg-superficie">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-borda text-left text-xs text-tinta-fraca">
                                <th className="px-3 py-2 font-medium">Artigo</th>
                                <th className="px-3 py-2 font-medium">Tags</th>
                                <th className="px-3 py-2 font-medium">Estado</th>
                                <th className="px-3 py-2 text-right font-medium" title="Leituras inteiras pelo agente, 30 dias">Lido</th>
                                <th className="px-3 py-2 font-medium">Atualizado</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {artigos.map((artigo) => (
                                <tr key={artigo.id} className="border-b border-borda last:border-0">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                            {artigo.global ? (
                                                <Globe
                                                    size={13}
                                                    className="shrink-0 text-tinta-sutil"
                                                    aria-label="vale para os três apps"
                                                />
                                            ) : null}
                                            <span className="text-tinta">{artigo.titulo}</span>
                                            {ORIGEM[artigo.origem] !== null ? (
                                                <span
                                                    className={`inline-block shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-medium ${ORIGEM[artigo.origem]?.cor ?? ''}`}
                                                    title={
                                                        artigo.fonte?.descricao !== null && artigo.fonte?.descricao !== undefined
                                                            ? `${artigo.fonte.descricao}${artigo.sincronizadoEm !== null ? ` · sincronizado ${new Date(artigo.sincronizadoEm).toLocaleString('pt-BR')}` : ''}${artigo.fonte.extraidoPor === 'modelo' ? ' · extraído por IA' : ''}`
                                                            : undefined
                                                    }
                                                >
                                                    {ORIGEM[artigo.origem]?.rotulo}
                                                </span>
                                            ) : null}
                                            {artigo.fonte?.url !== null && artigo.fonte?.url !== undefined ? (
                                                <a
                                                    href={artigo.fonte.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title={artigo.fonte.caminho ?? 'fonte no GitHub'}
                                                    className="shrink-0 text-tinta-sutil hover:text-destaque"
                                                >
                                                    <ExternalLink size={12} aria-label="abrir a fonte no GitHub" />
                                                </a>
                                            ) : null}
                                            {artigo.statusFixadoPor !== null ? (
                                                <span className="text-[10px] text-tinta-sutil" title="uma pessoa fixou o status; a sincronização não mexe">
                                                    fixado
                                                </span>
                                            ) : null}
                                            {artigo.fontesMudaram.length > 0 ? (
                                                <span
                                                    className="shrink-0 rounded-xs bg-atencao-fundo px-1.5 py-0.5 text-[10px] font-medium text-atencao"
                                                    title={`A fonte mudou desde que este rascunho foi escrito: ${artigo.fontesMudaram.join(', ')}. Vale reler antes de publicar.`}
                                                >
                                                    fonte mudou
                                                </span>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-tinta-fraca">
                                        {artigo.tags.join(', ') || '—'}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span
                                            className={`inline-block rounded-xs px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${CORES[artigo.status]}`}
                                        >
                                            {ROTULOS[artigo.status]}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs tabular-nums text-tinta-fraca">
                                        {/* Zero fica apagado: a coluna existe para
                                            destacar o que É lido, não para
                                            envergonhar o que não é. */}
                                        {artigo.leituras === 0 ? (
                                            <span className="text-tinta-sutil">—</span>
                                        ) : (
                                            artigo.leituras
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Quando iso={artigo.atualizadoEm} />
                                    </td>
                                    <td className="px-3 py-2">
                                        {podeEditar ? (
                                            <div className="flex justify-end gap-1.5">
                                                {/* Derivado não se edita aqui: a próxima
                                                    sincronização reescreveria. O lugar é a fonte. */}
                                                <Acao
                                                    onClick={() => abrir(artigo)}
                                                    desabilitado={artigo.origem === 'DERIVADO'}
                                                >
                                                    editar
                                                </Acao>
                                                {artigo.status !== 'PUBLICADO' ? (
                                                    <Acao
                                                        onClick={() =>
                                                            mudarStatus.mutate({
                                                                id: artigo.id,
                                                                status: 'PUBLICADO',
                                                            })
                                                        }
                                                        /// Arquivado não vai direto ao ar:
                                                        /// quem arquivou tirou por um motivo.
                                                        desabilitado={artigo.status === 'ARQUIVADO'}
                                                    >
                                                        publicar
                                                    </Acao>
                                                ) : (
                                                    <Acao
                                                        onClick={() =>
                                                            mudarStatus.mutate({
                                                                id: artigo.id,
                                                                status: 'RASCUNHO',
                                                            })
                                                        }
                                                    >
                                                        tirar do ar
                                                    </Acao>
                                                )}
                                            </div>
                                        ) : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function Acao({
    children,
    onClick,
    desabilitado,
}: {
    children: string
    onClick: () => void
    desabilitado?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={desabilitado}
            title={desabilitado ? 'Tire do arquivo primeiro: republicar sem reler desfaz a decisão de quem arquivou.' : undefined}
            className="rounded-xs border border-borda px-2 py-0.5 text-[11px] text-tinta-fraca transition hover:text-tinta disabled:opacity-40"
        >
            {children}
        </button>
    )
}

type Rascunho = typeof RASCUNHO_VAZIO

function Editor({
    rascunho,
    setRascunho,
    editando,
    salvando,
    onSalvar,
    onCancelar,
}: {
    rascunho: Rascunho
    setRascunho: (r: Rascunho) => void
    editando: string | null
    salvando: boolean
    onSalvar: () => void
    onCancelar: () => void
}) {
    return (
        <section className="space-y-3 rounded-sm border border-borda bg-superficie p-4">
            <h2 className="flex items-center gap-1.5 text-xs font-medium text-tinta-fraca">
                {editando === null ? (
                    <>
                        <Plus size={13} aria-hidden /> Artigo novo
                    </>
                ) : (
                    'Editando'
                )}
            </h2>

            <Campo
                rotulo="Título — é por ele que a busca acha o artigo"
                valor={rascunho.titulo}
                onChange={(v) => setRascunho({ ...rascunho, titulo: v })}
            />

            <label className="block">
                <span className="mb-1 block text-xs font-medium text-tinta-fraca">
                    Corpo — a resposta, como você a daria ao cliente
                </span>
                <textarea
                    rows={8}
                    value={rascunho.corpo}
                    onChange={(e) => setRascunho({ ...rascunho, corpo: e.target.value })}
                    className="w-full rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
                />
            </label>

            <Campo
                rotulo="Tags, separadas por vírgula — as palavras que o cliente usaria"
                valor={rascunho.tags}
                onChange={(v) => setRascunho({ ...rascunho, tags: v })}
            />

            <label className="flex items-start gap-2 text-xs">
                <input
                    type="checkbox"
                    checked={rascunho.global}
                    onChange={(e) => setRascunho({ ...rascunho, global: e.target.checked })}
                    className="mt-0.5"
                />
                <span>
                    Vale para os três produtos
                    <span className="block text-[11px] text-tinta-sutil">
                        Marque quando a resposta não muda entre Odontobox, Conecta e Stagent —
                        trocar a senha, por exemplo. Editar um artigo global muda os três.
                    </span>
                </span>
            </label>

            <div className="flex items-center gap-3">
                <Botao desabilitado={salvando} onClick={onSalvar}>
                    {salvando ? 'Salvando…' : editando === null ? 'Criar rascunho' : 'Salvar'}
                </Botao>
                {editando === null ? (
                    <span className="text-[11px] text-tinta-sutil">
                        Nasce fora do ar. Publicar é um segundo clique.
                    </span>
                ) : (
                    <Botao variante="leve" onClick={onCancelar}>
                        Cancelar
                    </Botao>
                )}
            </div>
        </section>
    )
}

/**
 * As perguntas que a base não respondeu — a fila de quem escreve.
 *
 * É o indicador mais útil desta tela e por isso vem ANTES da lista de
 * artigos: com a base vazia, a pergunta de quem vai redigir é "por onde
 * começo?", e a resposta honesta não é um palpite — é o que as pessoas
 * perguntaram e não acharam, do mais frequente ao menos.
 */
const ROTULO_DA_DIVERGENCIA: Record<Divergencia['tipo'], string> = {
    conteudo: 'texto diferente',
    ausente: 'falta aqui',
    'palavra-de-outro-nicho': 'palavra de outro nicho',
}

/**
 * O que difere entre os três apps além do vocabulário.
 *
 * Fica nesta tela, e não numa própria, porque é a mesma pergunta da base: o que
 * está errado no que o agente vai ler. Recolhido por padrão — é diagnóstico,
 * não trabalho do dia — e silencioso quando não há nada.
 */
function Divergencias() {
    const [aberto, setAberto] = useState(false)
    const { data } = useQuery({
        queryKey: ['divergencias'],
        queryFn: () => api<DivergenciasDaApi>('/divergencias'),
        staleTime: 5 * 60_000,
    })

    if (data === undefined) return null

    /**
     * Sem dois apps comparáveis não há resposta, e dizer isso é diferente de
     * mostrar lista vazia: lista vazia leria como "nada divergente", quando o
     * certo é "ainda não deu para comparar". O vocabulário entra no resultado
     * da sincronização, então basta uma rodada nova.
     */
    if (data.apps.length < 2) {
        return (
            <section className="rounded-sm border border-borda bg-superficie p-4 text-xs text-tinta-fraca">
                A comparação entre os apps fica disponível depois da próxima sincronização de cada um.
            </section>
        )
    }

    if (data.achados.length === 0) {
        return (
            <section className="rounded-sm border border-borda bg-superficie p-4 text-xs text-tinta-fraca">
                Nada diverge entre {data.apps.join(', ')} além do vocabulário de cada marca.
            </section>
        )
    }

    return (
        <section className="space-y-2 rounded-sm border border-atencao/40 bg-atencao-fundo p-4">
            <button type="button" onClick={() => setAberto(!aberto)} className="flex w-full items-baseline justify-between gap-3 text-left">
                <h2 className="text-xs font-medium text-atencao">
                    {data.achados.length} diferença(s) entre os apps além do vocabulário
                </h2>
                <span className="shrink-0 text-[11px] text-tinta-sutil">
                    {data.porTipo.conteudo} de texto · {data.porTipo.ausente} faltando ·{' '}
                    {data.porTipo.palavraDeOutroNicho} de outro nicho · {aberto ? 'fechar' : 'ver'}
                </span>
            </button>

            <p className="text-[11px] text-tinta-sutil">
                Comparado com o {data.referencia}, que é o app mais antigo. Os três produtos
                compartilham o mesmo código, então o que difere aqui foi escrito à mão em algum
                deles.
            </p>

            {aberto ? (
                <ul className="space-y-1">
                    {data.achados.slice(0, 40).map((d) => (
                        <li key={`${d.app}-${d.tipo}-${d.chave}`} className="text-xs">
                            <span className="text-tinta-sutil">{d.app}</span>{' '}
                            <span className="rounded-xs bg-superficie px-1 py-0.5 text-[10px] text-tinta-fraca">
                                {ROTULO_DA_DIVERGENCIA[d.tipo]}
                            </span>{' '}
                            <span className="text-tinta">{d.chave}</span>
                            <span className="ml-2 text-tinta-sutil">{d.detalhe}</span>
                        </li>
                    ))}
                    {data.achados.length > 40 ? (
                        <li className="text-[11px] text-tinta-sutil">
                            e mais {data.achados.length - 40}.
                        </li>
                    ) : null}
                </ul>
            ) : null}
        </section>
    )
}

function Lacunas({
    consultas,
    aoEscrever,
}: {
    consultas: ResumoDeConsultas
    aoEscrever?: ((exemplo: string) => void) | undefined
}) {
    return (
        <section className="space-y-2 rounded-sm border border-atencao/40 bg-atencao-fundo p-4">
            <h2 className="text-xs font-medium text-atencao">
                Dúvidas sem artigo — {consultas.semResposta} de {consultas.total} consulta(s) em{' '}
                {consultas.dias} dias
            </h2>
            <ul className="space-y-1">
                {consultas.lacunas.slice(0, 8).map((l) => (
                    <li key={l.exemplo} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-tinta">
                            {/* Como alguém escreveu, com aspas: é citação, não título. */}
                            “{l.exemplo}”
                            <span className="ml-2 text-tinta-sutil">
                                ×{l.vezes} · <Quando iso={l.ultimaEm} />
                            </span>
                        </span>
                        {aoEscrever !== undefined ? (
                            <button
                                type="button"
                                onClick={() => aoEscrever(l.exemplo)}
                                className="shrink-0 rounded-xs border border-borda px-2 py-0.5 text-[11px] text-tinta-fraca transition hover:text-tinta"
                            >
                                escrever
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>
            {consultas.lacunas.length > 8 ? (
                <p className="text-[11px] text-tinta-sutil">
                    e mais {consultas.lacunas.length - 8} — as oito acima são as mais frequentes.
                </p>
            ) : null}
        </section>
    )
}
