-- O registro de gasto de IA, por app e por origem.
--
-- Existe por um incidente datado: em 20/11/2026 as rodadas da bateria somaram
-- US$ 229 num dia e o relato ao fim do dia disse US$ 60. O custo de cada
-- chamada ao modelo existia só no terminal ou no log do Worker, que expira — e
-- o custo das telas documentadas não entrava nem no resultado da sincronização,
-- porque cada tela é uma mensagem de fila à parte.
--
-- Gasto que não é registrado é gasto que cresce sem ninguém ver. Uma linha por
-- chamada, com a origem, torna "quanto gastamos ontem, e com o quê" uma
-- consulta em vez de uma reconstrução.
CREATE TABLE "ia_gastos" (
    "id" TEXT NOT NULL,
    "app_id" TEXT,
    "origem" TEXT NOT NULL,
    -- O que foi processado: a rota da tela, o id do chamado, a chave do artigo.
    -- Texto livre de propósito: cada origem tem a sua própria noção de unidade.
    "referencia" TEXT,
    "modelo" TEXT,
    "tokens_de_entrada" INTEGER NOT NULL DEFAULT 0,
    "tokens_de_saida" INTEGER NOT NULL DEFAULT 0,
    "custo_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ia_gastos_pkey" PRIMARY KEY ("id")
);

-- A consulta que importa é "quanto este app gastou desde tal hora", e ela roda
-- a cada minuto no cão de guarda de custo.
CREATE INDEX "ia_gastos_app_id_criado_em_idx" ON "ia_gastos"("app_id", "criado_em");
CREATE INDEX "ia_gastos_origem_criado_em_idx" ON "ia_gastos"("origem", "criado_em");
