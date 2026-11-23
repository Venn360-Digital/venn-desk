-- Macros e tags (Fase 7).
--
-- As tabelas `tags`, `ticket_tags` e `macros` já existiam no schema desde a
-- Fase 1 e nunca foram usadas. O que falta aqui é só a exclusão LÓGICA da
-- macro: "nada é apagado" vale para a configuração do time também — uma macro
-- removida precisa continuar explicando as respostas que ela gerou no passado.
ALTER TABLE "macros" ADD COLUMN "excluido_em" TIMESTAMP(3);

-- A ordem da lista é decisão de quem a usa, e hoje ninguém a guarda: sem isto o
-- Postgres devolve na ordem física, que muda a cada atualização.
ALTER TABLE "macros" ADD COLUMN "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "macros_app_id_excluido_em_idx" ON "macros"("app_id", "excluido_em");
