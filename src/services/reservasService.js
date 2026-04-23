// src/services/reservasService.js
// ─────────────────────────────────────────────────────────────────────────────
// Camada de serviço: toda comunicação com o Firestore fica aqui.
// O App.jsx nunca chama o Firestore diretamente — só usa essas funções.
// Na hora de integrar: troque as chamadas de mock por essas funções.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getHorarioFim(inicio) {
  return `${String(parseInt(inicio) + 1).padStart(2, "0")}:00`;
}

// Converte uma data string "YYYY-MM-DD" para Timestamp do Firestore
function dateStrToTimestamp(dateStr) {
  return Timestamp.fromDate(new Date(dateStr + "T00:00:00"));
}

// ─── RESERVAS ────────────────────────────────────────────────────────────────

/**
 * Busca todas as reservas ativas de uma semana.
 * weekDates: array de { dateStr: "YYYY-MM-DD" }
 */
export async function getReservasDaSemana(weekDates) {
  const datas = weekDates.map((d) => d.dateStr);

  // Firestore não suporta "where in" com array de strings em campo Timestamp,
  // então buscamos pelo range de datas da semana.
  const inicio = datas[0];
  const fim    = datas[datas.length - 1];

  const q = query(
    collection(db, "reservas"),
    where("data", ">=", inicio),
    where("data", "<=", fim),
    where("cancelada", "==", false),
    orderBy("data"),
    orderBy("horarioInicio")
  );

  // ATENÇÃO: essa query precisa de índice composto no Firestore.
  // O Firebase vai te dar o link para criar automaticamente quando der erro.
  // Campos do índice: data ASC, horarioInicio ASC, cancelada ASC

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Verifica se já existe reserva ativa no mesmo campo/data/horário.
 * Retorna true se houver conflito.
 */
export async function verificarConflito(campoId, data, horarioInicio) {
  const q = query(
    collection(db, "reservas"),
    where("campoId",       "==", campoId),
    where("data",          "==", data),
    where("horarioInicio", "==", horarioInicio),
    where("cancelada",     "==", false)
  );

  // Índice composto necessário: campoId + data + horarioInicio + cancelada
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * Cria uma reserva avulsa.
 * Verifica conflito antes de salvar.
 * Retorna { sucesso: true, id } ou { sucesso: false, erro: string }
 */
export async function criarReserva({ campoId, data, horarioInicio, nomeTime, telefone }) {
  try {
    const conflito = await verificarConflito(campoId, data, horarioInicio);
    if (conflito) {
      return { sucesso: false, erro: "Horário já reservado para este campo." };
    }

    const docRef = await addDoc(collection(db, "reservas"), {
      campoId,
      data,
      horarioInicio,
      horarioFim:    getHorarioFim(horarioInicio),
      nomeTime,
      telefone:      telefone || null,
      recorrenciaId: null,
      cancelada:     false,
      criadaEm:      serverTimestamp(),
    });

    return { sucesso: true, id: docRef.id };
  } catch (err) {
    console.error("Erro ao criar reserva:", err);
    return { sucesso: false, erro: "Erro ao salvar. Tente novamente." };
  }
}

/**
 * Cancela uma reserva (soft delete — nunca deletar do banco).
 */
export async function cancelarReserva(reservaId) {
  try {
    await updateDoc(doc(db, "reservas", reservaId), {
      cancelada:   true,
      canceladaEm: serverTimestamp(),
    });
    return { sucesso: true };
  } catch (err) {
    console.error("Erro ao cancelar reserva:", err);
    return { sucesso: false, erro: "Erro ao cancelar. Tente novamente." };
  }
}

// ─── RECORRÊNCIAS ────────────────────────────────────────────────────────────

/**
 * Gera as datas de ocorrência de uma recorrência para as próximas N semanas.
 */
function gerarDatasRecorrencia(diaSemana, dataInicio, dataFim, semanas = 8) {
  const datas = [];
  const base  = new Date(dataInicio + "T00:00:00");

  // Avança até o próximo dia da semana correto
  const diff = (diaSemana - base.getDay() + 7) % 7;
  base.setDate(base.getDate() + diff);

  const limite = dataFim ? new Date(dataFim + "T00:00:00") : null;

  for (let i = 0; i < semanas; i++) {
    const data = new Date(base);
    data.setDate(base.getDate() + i * 7);
    if (limite && data > limite) break;
    datas.push(data.toISOString().split("T")[0]);
  }

  return datas;
}

/**
 * Cria uma recorrência e já gera as reservas das próximas 8 semanas.
 * Pula slots com conflito sem cancelar o processo todo.
 * Retorna { sucesso, recorrenciaId, reservasCriadas, conflitos }
 */
export async function criarRecorrencia({
  campoId,
  diaSemana,
  horarioInicio,
  nomeTime,
  telefone,
  tipoDuracao,
  dataFim,
}) {
  try {
    const hoje      = new Date().toISOString().split("T")[0];
    const dataFimFinal = tipoDuracao === "indefinido" ? null : dataFim;

    // 1. Salva a recorrência
    const recRef = await addDoc(collection(db, "recorrencias"), {
      campoId,
      diaSemana,
      horarioInicio,
      horarioFim: getHorarioFim(horarioInicio),
      nomeTime,
      telefone:   telefone || null,
      ativa:      true,
      dataInicio: hoje,
      dataFim:    dataFimFinal,
      criadaEm:   serverTimestamp(),
    });

    // 2. Gera as reservas das próximas 8 semanas
    const datas = gerarDatasRecorrencia(diaSemana, hoje, dataFimFinal, 8);

    let reservasCriadas = 0;
    let conflitos       = 0;

    for (const data of datas) {
      const conflito = await verificarConflito(campoId, data, horarioInicio);
      if (conflito) { conflitos++; continue; }

      await addDoc(collection(db, "reservas"), {
        campoId,
        data,
        horarioInicio,
        horarioFim:    getHorarioFim(horarioInicio),
        nomeTime,
        telefone:      telefone || null,
        recorrenciaId: recRef.id,
        cancelada:     false,
        criadaEm:      serverTimestamp(),
      });
      reservasCriadas++;
    }

    return {
      sucesso: true,
      recorrenciaId: recRef.id,
      reservasCriadas,
      conflitos,
    };
  } catch (err) {
    console.error("Erro ao criar recorrência:", err);
    return { sucesso: false, erro: "Erro ao salvar recorrência." };
  }
}

/**
 * Cancela todas as reservas futuras de uma recorrência.
 * NÃO cancela reservas passadas.
 */
export async function cancelarRecorrencia(recorrenciaId) {
  try {
    const hoje = new Date().toISOString().split("T")[0];

    // Desativa a recorrência
    await updateDoc(doc(db, "recorrencias", recorrenciaId), {
      ativa:       false,
      canceladaEm: serverTimestamp(),
    });

    // Busca e cancela reservas futuras
    const q = query(
      collection(db, "reservas"),
      where("recorrenciaId", "==", recorrenciaId),
      where("data",          ">=", hoje),
      where("cancelada",     "==", false)
    );
    const snapshot = await getDocs(q);
    const cancels  = snapshot.docs.map((d) =>
      updateDoc(doc(db, "reservas", d.id), {
        cancelada:   true,
        canceladaEm: serverTimestamp(),
      })
    );
    await Promise.all(cancels);

    return { sucesso: true, canceladas: snapshot.size };
  } catch (err) {
    console.error("Erro ao cancelar recorrência:", err);
    return { sucesso: false, erro: "Erro ao cancelar recorrência." };
  }
}
