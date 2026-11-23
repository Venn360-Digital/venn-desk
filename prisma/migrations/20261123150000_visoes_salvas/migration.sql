-- Visões salvas da fila (Fase 7).
--
-- Sem `app_id`, e isso é a diferença em relação às macros: a fila do Console é
-- ÚNICA e cruza os três produtos — "urgentes sem responsável, em qualquer app"
-- é exatamente o tipo de visão que se quer salvar. Amarrá-la a um app faria
-- cada pessoa salvar a mesma visão três vezes.
--
-- `agente_id` nulo é visão do time, visível a todos; preenchido, é a visão
-- pessoal de alguém. Exclusão é lógica, como no resto.
CREATE TABLE "visoes_salvas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    -- Os mesmos filtros que a fila já aceita na query. JSON porque o conjunto
    -- cresce com a tela, e uma coluna por filtro faria de cada filtro novo uma
    -- migração.
    "filtros" JSONB NOT NULL,
    "agente_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "visoes_salvas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visoes_salvas_agente_id_excluido_em_idx" ON "visoes_salvas"("agente_id", "excluido_em");
