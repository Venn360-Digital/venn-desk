-- A meta original do relógio, em minutos. Não é redundante com `vence_em`:
-- esse ANDA quando o relógio pausa e retoma, então sem guardar a meta o aviso
-- de "em risco" deixa de ser calculável no primeiro chamado que esperou o
-- usuário.
--
-- `sla_timers` está vazia (os relógios entram nesta mesma mudança), então a
-- coluna entra NOT NULL sem default e sem backfill.
ALTER TABLE "sla_timers" ADD COLUMN "meta_min" INTEGER NOT NULL;

-- O cão de guarda varre por vencimento entre os relógios ainda abertos.
CREATE INDEX "sla_timers_app_id_vence_em_abertos_idx"
    ON "sla_timers"("app_id", "vence_em")
    WHERE "cumprido_em" IS NULL AND "violado_em" IS NULL AND "pausado_em" IS NULL;
