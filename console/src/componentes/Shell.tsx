import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
    Gauge,
    Inbox,
    KeyRound,
    Layers,
    BarChart3,
    BookOpen,
    MessageCircle,
    Monitor,
    Moon,
    PanelLeft,
    Sun,
} from 'lucide-react'

import { aplicarTema, lerTema, type Tema } from '../tema.ts'

/**
 * A casca do Console: calha à esquerda, barra no topo, rodapé embaixo.
 *
 * É a mesma estrutura do painel dos apps (`AppSidebar` + `Topbar` +
 * `SidebarInset` no `@venn/core`), reescrita aqui porque os dois vivem em
 * repositórios diferentes e `@venn/ui` é um pacote de workspace do monorepo —
 * não há como importá-lo daqui sem publicar. O que foi copiado é o DESENHO:
 * larguras, densidade, a calha que recolhe para só os ícones, o conteúdo como
 * cartão arredondado sobre o fundo da calha.
 *
 * **A altura é presa à viewport de propósito.** Deixando o documento crescer, a
 * barra do topo sobe junto com o conteúdo e sai de vista — e numa fila de 50
 * linhas isso acontece sempre. Só a região do conteúdo rola.
 */

const CHAVE_DA_CALHA = 'venn-desk-calha'

interface Secao {
    para: string
    rotulo: string
    Icone: typeof Inbox
    fim?: boolean
}

const SECOES: Secao[] = [
    { para: '/', rotulo: 'Fila', Icone: Inbox, fim: true },
    { para: '/painel', rotulo: 'Painel', Icone: BarChart3 },
    { para: '/metas', rotulo: 'Metas', Icone: Gauge },
    { para: '/credenciais', rotulo: 'Credenciais', Icone: KeyRound },
    { para: '/base', rotulo: 'Base', Icone: BookOpen },
    { para: '/aparencia', rotulo: 'Aparência', Icone: MessageCircle },
    { para: '/apps', rotulo: 'Apps', Icone: Layers },
]

export function Shell({
    agente,
    titulo,
    acoes,
    children,
    aoSair,
}: {
    agente: { nome: string; papel: string }
    titulo: string
    acoes?: ReactNode
    children: ReactNode
    aoSair: () => void
}) {
    const [recolhida, setRecolhida] = useState(() => {
        try {
            return localStorage.getItem(CHAVE_DA_CALHA) === 'recolhida'
        } catch {
            return false
        }
    })

    useEffect(() => {
        try {
            localStorage.setItem(CHAVE_DA_CALHA, recolhida ? 'recolhida' : 'aberta')
        } catch {
            /// Sem armazenamento, a preferência vale esta visita.
        }
    }, [recolhida])

    /**
     * `h-dvh` + `overflow-hidden`, e o respiro como PADDING do grid — não como
     * margem do cartão.
     *
     * Com `my-2` no cartão, a margem somava aos 100vh do grid: o documento
     * ficava mais alto que a viewport, rolava inteiro, e a barra do topo saía
     * de vista — o defeito que o cabeçalho deste arquivo diz existir para
     * evitar. Padding no container não soma, porque a caixa é `border-box`.
     *
     * `dvh` e não `vh`: no celular a barra do navegador recolhe, e `vh` mede a
     * altura sem ela.
     */
    return (
        <div className="grid h-dvh grid-cols-[auto_1fr] overflow-hidden bg-superficie-2 md:py-2 md:pr-2">
            <a
                href="#conteudo"
                className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded-sm focus:bg-superficie focus:px-3 focus:py-2 focus:text-sm"
            >
                Pular para o conteúdo
            </a>

            <aside
                className={`flex flex-col gap-1 py-3 transition-[width] duration-200 ${
                    recolhida ? 'w-16 px-2' : 'w-60 px-3'
                }`}
            >
                <div className={`mb-4 flex h-9 items-center ${recolhida ? 'justify-center' : 'px-1'}`}>
                    <Marca recolhida={recolhida} />
                </div>

                <nav className="flex flex-col gap-0.5">
                    {SECOES.map(({ para, rotulo, Icone, fim }) => (
                        <NavLink
                            key={para}
                            to={para}
                            end={fim ?? false}
                            title={recolhida ? rotulo : undefined}
                            className={({ isActive }) =>
                                [
                                    'flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition',
                                    recolhida ? 'justify-center' : '',
                                    isActive
                                        ? 'bg-superficie font-medium text-tinta shadow-marca-sm'
                                        : 'text-tinta-fraca hover:bg-superficie/60 hover:text-tinta',
                                ].join(' ')
                            }
                        >
                            <Icone size={17} strokeWidth={1.75} aria-hidden />
                            {recolhida ? <span className="sr-only">{rotulo}</span> : rotulo}
                        </NavLink>
                    ))}
                </nav>

                <div className="mt-auto flex flex-col gap-1">
                    <SeletorDeTema recolhida={recolhida} />
                    <button
                        onClick={() => setRecolhida((r) => !r)}
                        aria-pressed={recolhida}
                        title={recolhida ? 'Expandir a calha' : 'Recolher a calha'}
                        className={`flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-tinta-fraca transition hover:bg-superficie/60 hover:text-tinta ${
                            recolhida ? 'justify-center' : ''
                        }`}
                    >
                        <PanelLeft size={17} strokeWidth={1.75} aria-hidden />
                        {recolhida ? <span className="sr-only">Expandir</span> : 'Recolher'}
                    </button>
                </div>
            </aside>

            {/* O conteúdo como cartão: é o `inset` do shadcn, que os apps usam. */}
            <div className="flex min-w-0 flex-col overflow-hidden rounded-l-md border border-borda bg-fundo md:rounded-md">
                <header className="flex h-14 shrink-0 items-center gap-3 border-b border-borda px-5">
                    <h1 className="truncate text-sm font-semibold">{titulo}</h1>
                    <div className="ml-auto flex items-center gap-3">
                        {acoes}
                        <span className="hidden text-xs text-tinta-sutil sm:inline">
                            {agente.nome} · {agente.papel.toLowerCase()}
                        </span>
                        <button
                            onClick={aoSair}
                            className="text-xs text-tinta-fraca transition hover:text-tinta hover:underline"
                        >
                            sair
                        </button>
                    </div>
                </header>

                <main id="conteudo" className="min-h-0 flex-1 overflow-auto px-5 py-5">
                    {children}
                </main>

                <footer className="flex h-9 shrink-0 items-center gap-2 border-t border-borda px-5 text-[11px] text-tinta-sutil">
                    <span>Venn Desk</span>
                    <span aria-hidden>·</span>
                    <span>Venn360</span>
                    <a
                        className="ml-auto transition hover:text-tinta-fraca"
                        href="https://venn360-digital.github.io/venn-desk/"
                        target="_blank"
                        rel="noreferrer"
                    >
                        status dos sistemas
                    </a>
                </footer>
            </div>
        </div>
    )
}

/**
 * A marca. Duas imagens, não uma com filtro.
 *
 * O material entregue avisa que os arquivos têm fundo incorporado e que não se
 * deve remover o fundo por limiar automático — então `invert()` está fora. A
 * troca é por CSS (`.marca-clara` / `.marca-escura` em `estilo.css`), e não por
 * JavaScript, para o logotipo certo já vir no primeiro quadro.
 */
export function Marca({ recolhida = false }: { recolhida?: boolean }) {
    if (recolhida) {
        return (
            <img
                src="/logomarca/emblema-64.png"
                alt="Venn360"
                width={28}
                height={21}
                className="h-5 w-auto"
            />
        )
    }

    return (
        <>
            <img
                src="/logomarca/marca-clara.png"
                alt="Venn360"
                width={456}
                height={103}
                className="marca-clara h-5 w-auto"
            />
            <img
                src="/logomarca/marca-escura.png"
                alt=""
                aria-hidden
                width={456}
                height={103}
                className="marca-escura h-5 w-auto"
            />
        </>
    )
}

const TEMAS: { valor: Tema; rotulo: string; Icone: typeof Sun }[] = [
    { valor: 'light', rotulo: 'Claro', Icone: Sun },
    { valor: 'dark', rotulo: 'Escuro', Icone: Moon },
    { valor: 'system', rotulo: 'Sistema', Icone: Monitor },
]

function SeletorDeTema({ recolhida }: { recolhida: boolean }) {
    const [tema, setTema] = useState<Tema>(() => lerTema())

    function trocar(novo: Tema) {
        aplicarTema(novo)
        setTema(novo)
    }

    /// Recolhida, a calha não tem largura para três botões: vira um só, que
    /// cicla. Expandida, os três ficam visíveis — escolher é mais rápido que
    /// adivinhar quantos cliques faltam.
    if (recolhida) {
        const atual = TEMAS.find((t) => t.valor === tema) ?? TEMAS[2]!
        const proximo = TEMAS[(TEMAS.indexOf(atual) + 1) % TEMAS.length]!

        return (
            <button
                onClick={() => trocar(proximo.valor)}
                title={`Tema: ${atual.rotulo}. Trocar para ${proximo.rotulo}.`}
                className="flex justify-center rounded-sm px-2.5 py-2 text-tinta-fraca transition hover:bg-superficie/60 hover:text-tinta"
            >
                <atual.Icone size={17} strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Tema: {atual.rotulo}</span>
            </button>
        )
    }

    return (
        <div role="group" aria-label="Tema" className="flex gap-0.5 rounded-sm p-0.5">
            {TEMAS.map(({ valor, rotulo, Icone }) => (
                <button
                    key={valor}
                    onClick={() => trocar(valor)}
                    aria-pressed={tema === valor}
                    title={rotulo}
                    className={`flex flex-1 justify-center rounded-xs py-1.5 transition ${
                        tema === valor
                            ? 'bg-superficie text-tinta shadow-marca-sm'
                            : 'text-tinta-sutil hover:text-tinta'
                    }`}
                >
                    <Icone size={15} strokeWidth={1.75} aria-hidden />
                    <span className="sr-only">{rotulo}</span>
                </button>
            ))}
        </div>
    )
}
