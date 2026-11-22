-- O aviso de RISCO do SLA (Fase 7).
--
-- Até aqui o cão de guarda avisava a violação: o prazo já tinha estourado, e o
-- alerta informava o prejuízo. O aviso de risco chega na fatia final do prazo,
-- quando ainda dá para alguém pegar o chamado.
--
-- A coluna existe porque o alerta não pode repetir. O cron roda a cada minuto e
-- um relógio fica "em risco" por minutos ou horas — sem marca, o canal receberia
-- a mesma linha centenas de vezes, que é o mesmo que não receber nenhuma.
ALTER TABLE "sla_timers" ADD COLUMN "avisado_em" TIMESTAMP(3);
