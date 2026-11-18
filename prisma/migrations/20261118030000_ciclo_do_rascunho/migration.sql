-- O ciclo do rascunho do modo sombra (seção 4): enviar, editar, descartar.
--
-- `editado_ao_enviar` é a métrica que decide quando um app pode sair do modo
-- sombra — 90% de envio sem edição em 30 chamados seguidos. Sem a coluna, a
-- pergunta não tem resposta e a saída vira palpite.
--
-- Descartar é lógico. A seção 10 não apaga nada, e saber o que a IA escreveu e
-- foi recusado é metade do aprendizado.
ALTER TABLE "ticket_messages" ADD COLUMN "aprovado_por" TEXT;
ALTER TABLE "ticket_messages" ADD COLUMN "aprovado_em" TIMESTAMP(3);
ALTER TABLE "ticket_messages" ADD COLUMN "editado_ao_enviar" BOOLEAN;
ALTER TABLE "ticket_messages" ADD COLUMN "descartado_em" TIMESTAMP(3);
ALTER TABLE "ticket_messages" ADD COLUMN "descartado_por" TEXT;

-- A fila de rascunhos pendentes por app: é o que a tela do Console consulta.
CREATE INDEX "ticket_messages_rascunhos_pendentes_idx"
    ON "ticket_messages"("app_id", "criado_em")
    WHERE "rascunho" = true AND "descartado_em" IS NULL;
