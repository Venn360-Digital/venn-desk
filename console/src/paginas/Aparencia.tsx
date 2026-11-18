import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'

import { api, type AppCadastrado, type TemaDoWidget } from '../api.ts'
import { Aviso, Botao, Campo, Vazio } from '../componentes/ui.tsx'

/**
 * A aparência do widget, por app.
 *
 * **Por que esta tela existe.** O widget é um pacote de código-fonte que cada
 * app compila junto, e a tentação é passar cor e textos como props no layout.
 * Feito assim, mudar a cor do botão do Conecta vira um deploy do Conecta — e
 * quem decide a cor não é quem faz deploy. Com a configuração aqui, a mudança
 * vale na próxima vez que alguém abrir a tela do app.
 *
 * **A pré-visualização não é enfeite.** Escolher cor de botão sem ver o botão é
 * adivinhar; e o aviso de contraste só significa alguma coisa ao lado da coisa
 * que ficou ilegível.
 */

export function Aparencia({ papel }: { papel: 'AGENTE' | 'GESTOR' | 'ADMIN' }) {
    const { app: daRota } = useParams<{ app: string }>()
    const fila = useQueryClient()
    const [tema, setTema] = useState<TemaDoWidget | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [salvo, setSalvo] = useState(false)

    const { data: cadastro } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
        staleTime: 5 * 60_000,
    })
    const apps = cadastro?.apps ?? []
    const app = daRota ?? apps[0]?.slug

    const { data, isPending } = useQuery({
        queryKey: ['tema', app],
        queryFn: () => api<{ tema: TemaDoWidget; avisos: { campo: string; texto: string }[] }>(
            `/app/${app}/tema`
        ),
        enabled: app !== undefined,
    })

    /// O estado local nasce do servidor e troca quando o app troca — sem isto,
    /// mudar de aba mostraria o tema do app anterior.
    useEffect(() => {
        if (data?.tema) setTema(data.tema)
        setSalvo(false)
    }, [data, app])

    const salvar = useMutation({
        mutationFn: (v: TemaDoWidget) => api(`/app/${app}/tema`, { metodo: 'PUT', corpo: v }),
        onSuccess: () => {
            setErro(null)
            setSalvo(true)
            void fila.invalidateQueries({ queryKey: ['tema', app] })
        },
        onError: (e: Error) => setErro(e.message),
    })

    if (isPending || tema === null) return <Vazio>carregando…</Vazio>
    const podeEditar = papel !== 'AGENTE'
    const mudar = <C extends keyof TemaDoWidget>(campo: C, valor: TemaDoWidget[C]) => {
        setTema({ ...tema, [campo]: valor })
        setSalvo(false)
    }

    /**
     * Apagar o nome REMOVE a chave, em vez de gravar `undefined`.
     *
     * Não é purismo: `JSON.stringify` descarta `undefined` num objeto, mas o
     * `avatar` ao lado tem de sobreviver à edição do nome — então a chave sai
     * por desestruturação e o resto do atendente continua inteiro.
     */
    const mudarNomeDoAtendente = (nome: string) => {
        const { nome: _antigo, ...resto } = tema.atendente
        mudar('atendente', nome === '' ? resto : { ...resto, nome })
    }

    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap gap-1">
                {apps.map((a) => (
                    <Link
                        key={a.slug}
                        to={`/aparencia/${a.slug}`}
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
                Vale para o widget dentro do app. A mudança não exige publicar nada: ela
                aparece na próxima vez que alguém abrir a tela.
            </p>

            {erro !== null ? <Aviso>{erro}</Aviso> : null}
            {(data?.avisos ?? []).map((a) => (
                <p
                    key={a.campo}
                    className="rounded-sm border border-atencao/40 bg-atencao-fundo px-3 py-2 text-xs text-atencao"
                >
                    {a.texto}
                </p>
            ))}

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                <div className="space-y-4">
                    <section className="space-y-3 rounded-sm border border-borda bg-superficie p-4">
                        <h2 className="text-xs font-medium text-tinta-fraca">Cor e posição</h2>

                        <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] text-tinta-sutil">
                                    Cor de destaque
                                </span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={tema.corDeDestaque ?? '#1F56B5'}
                                        disabled={!podeEditar}
                                        onChange={(e) => mudar('corDeDestaque', e.target.value.toUpperCase())}
                                        className="h-8 w-12 cursor-pointer rounded-xs border border-borda bg-superficie"
                                    />
                                    <input
                                        value={tema.corDeDestaque ?? ''}
                                        placeholder="herda do app"
                                        disabled={!podeEditar}
                                        onChange={(e) =>
                                            mudar(
                                                'corDeDestaque',
                                                e.target.value === ''
                                                    ? undefined
                                                    : e.target.value.toUpperCase()
                                            )
                                        }
                                        className="w-28 rounded-sm border border-borda bg-superficie px-2 py-1.5 font-mono text-xs"
                                    />
                                </div>
                            </label>

                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] text-tinta-sutil">Lado</span>
                                <select
                                    value={tema.posicao}
                                    disabled={!podeEditar}
                                    onChange={(e) =>
                                        mudar('posicao', e.target.value as TemaDoWidget['posicao'])
                                    }
                                    className="rounded-sm border border-borda bg-superficie px-2 py-1.5 text-xs"
                                >
                                    <option value="direita">direita</option>
                                    <option value="esquerda">esquerda</option>
                                </select>
                            </label>

                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] text-tinta-sutil">
                                    Margem (px)
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={120}
                                    value={tema.margem}
                                    disabled={!podeEditar}
                                    onChange={(e) => mudar('margem', Number(e.target.value))}
                                    className="w-20 rounded-sm border border-borda bg-superficie px-2 py-1.5 text-xs"
                                />
                            </label>

                            <label className="flex items-center gap-2 pb-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={tema.mostrarBotao}
                                    disabled={!podeEditar}
                                    onChange={(e) => mudar('mostrarBotao', e.target.checked)}
                                />
                                mostrar o botão
                            </label>
                        </div>
                        <p className="text-[11px] text-tinta-sutil">
                            Cor em branco faz o widget herdar a cor do próprio app — é o
                            padrão, e costuma ser o certo.
                        </p>
                    </section>

                    <section className="space-y-3 rounded-sm border border-borda bg-superficie p-4">
                        <h2 className="text-xs font-medium text-tinta-fraca">Quem atende</h2>
                        <Campo
                            rotulo="Nome do atendente"
                            valor={tema.atendente.nome ?? ''}
                            onChange={mudarNomeDoAtendente}
                            desabilitado={!podeEditar}
                        />
                        <Campo
                            rotulo="Saudação (a primeira frase do painel)"
                            valor={tema.saudacao ?? ''}
                            onChange={(v) => mudar('saudacao', v === '' ? undefined : v)}
                            desabilitado={!podeEditar}
                        />
                        <Campo
                            rotulo="Como esse nicho chama a empresa (clínica, agência, estúdio)"
                            valor={tema.organizacao ?? ''}
                            onChange={(v) => mudar('organizacao', v === '' ? undefined : v)}
                            desabilitado={!podeEditar}
                        />
                    </section>

                    <section className="space-y-2 rounded-sm border border-borda bg-superficie p-4">
                        <h2 className="text-xs font-medium text-tinta-fraca">
                            Módulos do app
                        </h2>
                        <p className="text-[11px] text-tinta-sutil">
                            Um por linha. É a lista de "onde aconteceu" que o usuário escolhe
                            ao abrir o chamado — e o que faz a IA saber de que parte do
                            produto ele está falando.
                        </p>
                        <textarea
                            rows={5}
                            value={tema.modulos.join('\n')}
                            disabled={!podeEditar}
                            onChange={(e) =>
                                mudar(
                                    'modulos',
                                    e.target.value.split('\n').map((m) => m.trim()).filter((m) => m !== '')
                                )
                            }
                            className="w-full rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
                        />
                    </section>

                    {podeEditar ? (
                        <div className="flex items-center gap-3">
                            <Botao
                                desabilitado={salvar.isPending}
                                onClick={() => salvar.mutate(tema)}
                            >
                                {salvar.isPending ? 'Salvando…' : 'Salvar'}
                            </Botao>
                            {salvo ? (
                                <span className="text-xs text-calmo">
                                    salvo — já vale no app
                                </span>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-xs text-tinta-fraca">
                            Só gestor ou admin altera a aparência.
                        </p>
                    )}
                </div>

                <Previa tema={tema} nomeDoApp={apps.find((a) => a.slug === app)?.nome ?? ''} />
            </div>
        </div>
    )
}

/**
 * A prévia.
 *
 * Ela desenha o botão e o começo do painel com as MESMAS regras do widget —
 * cor, lado, margem, nome e saudação. Não é o widget de verdade (ele precisa de
 * sessão de um cliente e de um app rodando), e por isso a tela diz isso: uma
 * prévia que se faz passar pelo produto é pior que nenhuma, porque esconde o
 * que ela não sabe reproduzir.
 */
function Previa({ tema, nomeDoApp }: { tema: TemaDoWidget; nomeDoApp: string }) {
    const cor = tema.corDeDestaque ?? '#1F56B5'
    const tinta = tema.corSobreDestaque ?? tintaPara(cor)
    const naDireita = tema.posicao === 'direita'

    return (
        <aside className="space-y-2">
            <h2 className="text-xs font-medium text-tinta-fraca">Prévia</h2>

            <div className="relative h-80 overflow-hidden rounded-md border border-borda bg-superficie-2">
                <div className="border-b border-borda bg-superficie px-3 py-2 text-[11px] text-tinta-sutil">
                    {nomeDoApp || 'o app'}
                </div>

                <div
                    className="absolute w-56 rounded-md border border-borda bg-superficie shadow-marca-md"
                    style={{
                        bottom: `${tema.margem + 48}px`,
                        [naDireita ? 'right' : 'left']: `${tema.margem}px`,
                    }}
                >
                    <div
                        className="flex items-center gap-2 rounded-t-md px-3 py-2 text-xs font-medium"
                        style={{ background: cor, color: tinta }}
                    >
                        {tema.atendente.nome ?? 'Suporte'}
                    </div>
                    <p className="px-3 py-3 text-[11px] text-tinta-fraca">
                        {tema.saudacao ?? 'Como podemos ajudar?'}
                    </p>
                </div>

                {tema.mostrarBotao ? (
                    <div
                        className="absolute flex items-center gap-1.5 px-3 py-2 text-xs font-medium shadow-marca-md"
                        style={{
                            background: cor,
                            color: tinta,
                            bottom: `${tema.margem}px`,
                            [naDireita ? 'right' : 'left']: `${tema.margem}px`,
                            borderRadius: 999,
                        }}
                    >
                        <MessageCircle size={14} aria-hidden />
                        Suporte
                    </div>
                ) : (
                    <p className="absolute bottom-3 w-full text-center text-[11px] text-tinta-sutil">
                        botão escondido
                    </p>
                )}
            </div>

            <p className="text-[11px] text-tinta-sutil">
                Aproximação. O widget de verdade herda tipografia e raio de canto do app, e
                só aparece para quem está logado nele.
            </p>
        </aside>
    )
}

/**
 * Entre preto e branco, o que se lê melhor sobre a cor.
 *
 * Repete `tintaPara` do servidor de propósito: a prévia precisa responder a
 * cada tecla, e uma ida ao servidor por caractere faria o contraste piscar
 * atrás do que a pessoa está digitando. O servidor continua sendo quem decide
 * no fim — isto é só o desenho.
 */
function tintaPara(fundo: string): string {
    const limpo = fundo.replace('#', '')
    const cheio = limpo.length === 3 ? limpo.split('').map((d) => d + d).join('') : limpo
    if (cheio.length !== 6) return '#FFFFFF'

    const canais = [0, 2, 4].map((i) => {
        const v = parseInt(cheio.slice(i, i + 2), 16) / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    const luz = 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!

    return luz > 0.4 ? '#111117' : '#FFFFFF'
}
