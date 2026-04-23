// src/App.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Versão integrada com Firebase Auth + Firestore.
// Substitui todos os dados mockados por chamadas reais.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import {
  getReservasDaSemana,
  criarReserva,
  cancelarReserva,
  criarRecorrencia,
} from "./services/reservasService";

// ─── CAMPOS (fixo — poderia vir do Firestore também) ─────────────────────────
const campos = Array.from({ length: 9 }, (_, i) => ({
  id: `campo${i + 1}`, nome: `Campo ${i + 1}`, ativo: true,
}));

const DAYS_CONFIG = [
  { diaSemana: 2, label: "TER", labelFull: "Terça-feira",  slots: ["20:00", "21:00"] },
  { diaSemana: 3, label: "QUA", labelFull: "Quarta-feira", slots: ["20:00", "21:00"] },
  { diaSemana: 4, label: "QUI", labelFull: "Quinta-feira", slots: ["20:00", "21:00"] },
  { diaSemana: 5, label: "SEX", labelFull: "Sexta-feira",  slots: ["20:00", "21:00"] },
  { diaSemana: 6, label: "SÁB", labelFull: "Sábado",       slots: ["15:00", "16:00", "17:00", "18:00"] },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const mono  = "'IBM Plex Mono', monospace";
const serif = "'DM Serif Display', serif";

function getHorarioFim(inicio) {
  return `${String(parseInt(inicio) + 1).padStart(2, "0")}:00`;
}
function getWeekDates(baseDate) {
  const d = new Date(baseDate);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return DAYS_CONFIG.map(cfg => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + cfg.diaSemana - 1);
    return { ...cfg, date, dateStr: date.toISOString().split("T")[0] };
  });
}
function formatWeekLabel(dates) {
  const opts = { day: "2-digit", month: "short" };
  return `${dates[0].date.toLocaleDateString("pt-BR", opts)} – ${dates[dates.length - 1].date.toLocaleDateString("pt-BR", opts)}`;
}
function formatDateLong(ds) {
  return new Date(ds + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
//function formatDateShort(ds) {
  //return new Date(ds + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit" });
//}
function getReservaLocal(reservas, campoId, dateStr, slot) {
  return reservas.find(r => r.campoId === campoId && r.data === dateStr && r.horarioInicio === slot && !r.cancelada);
}

// ─── EXPORT PDF ───────────────────────────────────────────────────────────────
function exportarResumoPDF(weekDates, reservas, weekLabel) {
  const reservasSemana = reservas.filter(r => weekDates.some(d => d.dateStr === r.data) && !r.cancelada);
  const total          = reservasSemana.length;
  const totalSlots     = weekDates.reduce((acc, d) => acc + d.slots.length * 9, 0);
  const ocupacao       = Math.round((total / totalSlots) * 100);
  const linhas         = weekDates.flatMap(day =>
    reservasSemana.filter(r => r.data === day.dateStr)
      .sort((a, b) => a.horarioInicio.localeCompare(b.horarioInicio))
      .map(r => ({ dia: day.labelFull, data: day.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), horario: `${r.horarioInicio} – ${r.horarioFim}`, campo: campos.find(c => c.id === r.campoId)?.nome, time: r.nomeTime, telefone: r.telefone || "—", recorrente: r.recorrenciaId ? "Sim" : "Não" }))
  );
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Resumo – ${weekLabel}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Mono',monospace;background:#fff;color:#111;padding:32px;font-size:11px}
.header{border-bottom:3px solid #111;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}
.title{font-size:22px;font-weight:600}.subtitle{font-size:11px;color:#555;margin-top:4px}.meta{font-size:10px;color:#555;text-align:right}
.stats{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
.stat{border:1px solid #ddd;border-radius:6px;padding:10px 16px;min-width:100px}
.stat-val{font-size:22px;font-weight:600}.stat-label{font-size:9px;color:#777;letter-spacing:0.08em;margin-top:2px}
table{width:100%;border-collapse:collapse}
th{background:#111;color:#fff;padding:8px 10px;text-align:left;font-size:9px;letter-spacing:0.1em}
td{padding:7px 10px;border-bottom:1px solid #eee;font-size:10px;vertical-align:middle}
tr:nth-child(even) td{background:#f9f9f9}
.badge{background:#111;color:#fff;border-radius:3px;padding:1px 5px;font-size:8px;letter-spacing:0.06em}
.footer{margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:9px;color:#999;display:flex;justify-content:space-between}
@media print{body{padding:20px}}
</style></head><body>
<div class="header"><div><div class="title">Arena Schedule</div><div class="subtitle">Resumo Semanal · ${weekLabel}</div></div><div class="meta">Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div></div>
<div class="stats">
  <div class="stat"><div class="stat-val">${total}</div><div class="stat-label">RESERVAS</div></div>
  <div class="stat"><div class="stat-val">${totalSlots - total}</div><div class="stat-label">LIVRES</div></div>
  <div class="stat"><div class="stat-val">${ocupacao}%</div><div class="stat-label">OCUPAÇÃO</div></div>
  <div class="stat"><div class="stat-val">${linhas.filter(l => l.recorrente === "Sim").length}</div><div class="stat-label">RECORRENTES</div></div>
</div>
<table><thead><tr><th>DIA</th><th>DATA</th><th>HORÁRIO</th><th>CAMPO</th><th>TIME / RESPONSÁVEL</th><th>TELEFONE</th><th>TIPO</th></tr></thead>
<tbody>${linhas.map(l => `<tr><td>${l.dia}</td><td>${l.data}</td><td>${l.horario}</td><td>${l.campo}</td><td><strong>${l.time}</strong></td><td>${l.telefone}</td><td>${l.recorrente === "Sim" ? '<span class="badge">↺ FIXO</span>' : "Avulso"}</td></tr>`).join("")}${!linhas.length ? `<tr><td colspan="7" style="text-align:center;color:#999;padding:24px">Nenhuma reserva nesta semana</td></tr>` : ""}</tbody></table>
<div class="footer"><span>Arena Schedule · Gestão de Campos</span><span>${total} reserva${total !== 1 ? "s" : ""} · ${weekLabel}</span></div>
</body></html>`;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const sectionLabel = { fontSize: "10px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: "10px" };

function SelectCard({ label, sublabel, selected, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: selected ? "rgba(74,222,128,0.12)" : hov ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)", border: `1.5px solid ${selected ? "rgba(74,222,128,0.5)" : hov ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.08)"}`, borderRadius: "8px", padding: "10px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: selected ? "#4ade80" : "#fff", fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        {sublabel && <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>{sublabel}</div>}
      </div>
      <div style={{ width: "16px", height: "16px", borderRadius: "50%", border: `1.5px solid ${selected ? "#4ade80" : "rgba(255,255,255,0.2)"}`, background: selected ? "#4ade80" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#080d08" }} />}
      </div>
    </button>
  );
}

function InputField({ label, required, value, onChange, placeholder, type = "text", error }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", display: "block", marginBottom: "6px" }}>
        {label} {required && <span style={{ color: "#f87171" }}>*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${error ? "rgba(239,68,68,0.5)" : focused ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.12)"}`, borderRadius: "8px", padding: "10px 14px", color: "#fff", fontSize: "13px", fontFamily: mono, outline: "none", transition: "border-color 0.15s" }} />
      {error && <p style={{ fontSize: "10px", color: "#f87171", marginTop: "4px" }}>{error}</p>}
    </div>
  );
}

function ModalBase({ onClose, children, maxWidth = "520px" }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)", padding: "16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0e1510", border: "1px solid rgba(74,222,128,0.2)", borderRadius: "14px", padding: "28px 32px", width: "100%", maxWidth, boxShadow: "0 0 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

function BtnClose({ onClick }) {
  return <button onClick={onClick} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: "20px", cursor: "pointer", lineHeight: 1 }}>✕</button>;
}

function Spinner() {
  return <div style={{ width: "16px", height: "16px", border: "2px solid rgba(74,222,128,0.2)", borderTopColor: "#4ade80", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />;
}

// ─── TELA LOGIN ───────────────────────────────────────────────────────────────
function TelaLogin() {
  const [email, setEmail]     = useState("");
  const [senha, setSenha]     = useState("");
  const [erro, setErro]       = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErro("");
    if (!email || !senha) { setErro("Preencha e-mail e senha."); return; }
    setLoading(true);
    try {
      // Firebase Auth — o usuário foi criado no Console do Firebase
      await signInWithEmailAndPassword(auth, email, senha);
      // onAuthStateChanged no App cuida do redirecionamento
    } catch (err) {
      const msgs = {
        "auth/invalid-credential":    "E-mail ou senha incorretos.",
        "auth/user-not-found":        "Usuário não encontrado.",
        "auth/wrong-password":        "Senha incorreta.",
        "auth/invalid-email":         "E-mail inválido.",
        "auth/too-many-requests":     "Muitas tentativas. Aguarde e tente novamente.",
      };
      setErro(msgs[err.code] || "Erro ao entrar. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080d08", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, padding: "16px" }}>
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>⚽</div>
          <h1 style={{ fontFamily: serif, fontSize: "28px", color: "#4ade80", lineHeight: 1 }}>Arena Schedule</h1>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "6px", letterSpacing: "0.08em" }}>ACESSO ADMINISTRATIVO</p>
        </div>
        <div style={{ background: "#0e1510", border: "1px solid rgba(74,222,128,0.15)", borderRadius: "14px", padding: "28px", boxShadow: "0 0 60px rgba(0,0,0,0.5)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
            <InputField label="E-MAIL" required type="email" value={email} onChange={setEmail} placeholder="admin@arena.com" />
            <InputField label="SENHA" required type="password" value={senha} onChange={v => { setSenha(v); setErro(""); }} placeholder="••••••••" error={erro} />
          </div>
          <button
            onClick={handleLogin} disabled={loading}
            style={{ width: "100%", padding: "12px", background: loading ? "rgba(74,222,128,0.06)" : "rgba(74,222,128,0.15)", border: `1px solid ${loading ? "rgba(74,222,128,0.2)" : "rgba(74,222,128,0.4)"}`, borderRadius: "8px", color: loading ? "rgba(74,222,128,0.4)" : "#4ade80", fontSize: "12px", cursor: loading ? "not-allowed" : "pointer", fontFamily: mono, fontWeight: 700, letterSpacing: "0.1em", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
          >
            {loading ? <><Spinner /> VERIFICANDO...</> : "ENTRAR →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: VER RESERVA ───────────────────────────────────────────────────────
function ModalReserva({ reserva, onClose, onCancelar }) {
  const [loading, setLoading] = useState(false);
  const campo = campos.find(c => c.id === reserva.campoId);

  const handleCancelar = async () => {
    setLoading(true);
    const result = await onCancelar(reserva.id);
    if (result.sucesso) { onClose(); }
    else { alert(result.erro); setLoading(false); }
  };

  return (
    <ModalBase onClose={onClose} maxWidth="360px">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "20px" }}>
        <div>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", letterSpacing: "0.1em", marginBottom: "4px" }}>RESERVA{reserva.recorrenciaId ? " · ↺ RECORRENTE" : ""}</p>
          <h2 style={{ color: "#4ade80", fontFamily: serif, fontSize: "22px" }}>{reserva.nomeTime}</h2>
        </div>
        <BtnClose onClick={onClose} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
        {[["Campo", campo?.nome], ["Data", formatDateLong(reserva.data)], ["Horário", `${reserva.horarioInicio} – ${reserva.horarioFim}`], ["Telefone", reserva.telefone || "—"]].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>{l}</span>
            <span style={{ fontSize: "12px", color: "#fff", fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{v}</span>
          </div>
        ))}
      </div>
      <button onClick={handleCancelar} disabled={loading}
        style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", color: "#f87171", fontSize: "11px", cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.08em", fontWeight: 600, fontFamily: mono, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
        {loading ? <><Spinner />CANCELANDO...</> : "CANCELAR RESERVA"}
      </button>
    </ModalBase>
  );
}

// ─── MODAL: NOVA RESERVA AVULSA ───────────────────────────────────────────────
function ModalNovaReserva({ slot, onClose, onSalvar }) {
  const [nomeTime, setNomeTime] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading]   = useState(false);
  const [erro, setErro]         = useState("");
  const campo = campos.find(c => c.id === slot.campoId);

  const handleSalvar = async () => {
    if (!nomeTime.trim()) return;
    setLoading(true);
    setErro("");
    const result = await onSalvar({
      campoId: slot.campoId, data: slot.dateStr,
      horarioInicio: slot.horario, nomeTime: nomeTime.trim(), telefone,
    });
    if (result.sucesso) { onClose(); }
    else { setErro(result.erro); setLoading(false); }
  };

  return (
    <ModalBase onClose={onClose} maxWidth="380px">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "20px" }}>
        <div>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px", letterSpacing: "0.12em", marginBottom: "4px" }}>NOVA RESERVA</p>
          <h2 style={{ fontFamily: serif, fontSize: "20px", color: "#4ade80" }}>{campo?.nome} · {slot.horario}</h2>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "4px" }}>{formatDateLong(slot.dateStr)}</p>
        </div>
        <BtnClose onClick={onClose} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>
        <InputField label="NOME DO TIME / RESPONSÁVEL" required value={nomeTime} onChange={setNomeTime} placeholder="Ex: Os Crias FC" />
        <InputField label="TELEFONE (opcional)" value={telefone} onChange={setTelefone} placeholder="Ex: 44 99999-1111" error={erro} />
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onClose} style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.4)", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>CANCELAR</button>
        <button onClick={handleSalvar} disabled={!nomeTime.trim() || loading}
          style={{ flex: 2, padding: "10px", background: nomeTime.trim() ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${nomeTime.trim() ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "8px", color: nomeTime.trim() ? "#4ade80" : "rgba(255,255,255,0.2)", fontSize: "11px", cursor: nomeTime.trim() && !loading ? "pointer" : "not-allowed", fontFamily: mono, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {loading ? <><Spinner />SALVANDO...</> : "CONFIRMAR ›"}
        </button>
      </div>
    </ModalBase>
  );
}

// ─── MODAL: RESUMO SEMANAL ────────────────────────────────────────────────────
function ModalResumo({ weekDates, reservas, weekLabel, onClose }) {
  const reservasSemana = reservas.filter(r => weekDates.some(d => d.dateStr === r.data) && !r.cancelada);
  const totalSlots     = weekDates.reduce((acc, d) => acc + d.slots.length * 9, 0);
  const ocupacao       = Math.round((reservasSemana.length / totalSlots) * 100);

  return (
    <ModalBase onClose={onClose} maxWidth="640px">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "20px" }}>
        <div>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px", letterSpacing: "0.12em", marginBottom: "4px" }}>RESUMO SEMANAL</p>
          <h2 style={{ fontFamily: serif, fontSize: "22px", color: "#4ade80" }}>{weekLabel}</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button onClick={() => exportarResumoPDF(weekDates, reservas, weekLabel)}
            style={{ padding: "8px 14px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: "7px", color: "#4ade80", fontSize: "11px", cursor: "pointer", fontFamily: mono, fontWeight: 600, letterSpacing: "0.06em" }}>
            ↓ EXPORTAR PDF
          </button>
          <BtnClose onClick={onClose} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "20px" }}>
        {[{ val: reservasSemana.length, label: "RESERVAS" }, { val: totalSlots - reservasSemana.length, label: "LIVRES" }, { val: `${ocupacao}%`, label: "OCUPAÇÃO" }, { val: reservasSemana.filter(r => r.recorrenciaId).length, label: "RECORRENTES" }].map(({ val, label }) => (
          <div key={label} style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#4ade80", fontFamily: mono }}>{val}</div>
            <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginTop: "2px" }}>{label}</div>
          </div>
        ))}
      </div>
      {weekDates.map(day => {
        const res = reservasSemana.filter(r => r.data === day.dateStr).sort((a, b) => a.horarioInicio.localeCompare(b.horarioInicio));
        if (!res.length) return null;
        return (
          <div key={day.dateStr} style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#4ade80", letterSpacing: "0.1em" }}>{day.labelFull.toUpperCase()}</span>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)" }}>{day.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {res.map(r => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "70px 80px 1fr auto", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.03)", borderRadius: "6px", padding: "8px 12px" }}>
                  <span style={{ fontSize: "11px", color: "#4ade80" }}>{r.horarioInicio}</span>
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{campos.find(c => c.id === r.campoId)?.nome}</span>
                  <span style={{ fontSize: "11px", color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nomeTime}</span>
                  <span style={{ fontSize: "9px", color: "rgba(74,222,128,0.6)" }}>{r.recorrenciaId ? "↺ FIXO" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!reservasSemana.length && <div style={{ textAlign: "center", padding: "32px", color: "rgba(255,255,255,0.2)", fontSize: "12px" }}>Nenhuma reserva nesta semana.</div>}
    </ModalBase>
  );
}

// ─── MODAL: RECORRÊNCIA ───────────────────────────────────────────────────────
const FORM_INICIAL = { diaSemana: null, horarioInicio: "", campoId: "", nomeTime: "", telefone: "", tipoDuracao: "indefinido", dataFim: "" };
function canAdv(step, form) {
  if (step === 1) return form.diaSemana && form.horarioInicio && form.campoId;
  if (step === 2) return form.nomeTime.trim().length > 0;
  if (step === 3) return form.tipoDuracao === "indefinido" || form.dataFim;
  return true;
}
function StepDot({ step }) {
  const steps = ["Horário", "Time", "Período", "Revisão"];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "24px" }}>
      {steps.map((label, i) => {
        const num = i + 1, active = num === step, done = num < step;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: done ? "#4ade80" : active ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.05)", border: done ? "none" : active ? "1.5px solid #4ade80" : "1.5px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: done ? "#080d08" : active ? "#4ade80" : "rgba(255,255,255,0.2)", transition: "all 0.3s" }}>
                {done ? "✓" : num}
              </div>
              <span style={{ fontSize: "9px", letterSpacing: "0.08em", color: active ? "#4ade80" : "rgba(255,255,255,0.25)", whiteSpace: "nowrap" }}>{label.toUpperCase()}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: "1px", background: done ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.08)", margin: "0 6px", marginBottom: "16px", transition: "all 0.3s" }} />}
          </div>
        );
      })}
    </div>
  );
}

function ModalRecorrencia({ onClose, onSalvar }) {
  const [step, setStep]     = useState(1);
  const [form, setForm]     = useState(FORM_INICIAL);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const dayConfig = DAYS_CONFIG.find(d => d.diaSemana === form.diaSemana);

  const handleSalvar = async () => {
    setLoading(true);
    const result = await onSalvar(form);
    setLoading(false);
    if (result.sucesso) { setResultado(result); }
    else { alert(result.erro); }
  };

  if (resultado) return (
    <ModalBase onClose={onClose} maxWidth="420px">
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: "44px", marginBottom: "12px" }}>✓</div>
        <h2 style={{ fontFamily: serif, color: "#4ade80", fontSize: "22px", marginBottom: "8px" }}>Recorrência criada!</h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>{resultado.reservasCriadas} reservas geradas.</p>
        {resultado.conflitos > 0 && <p style={{ fontSize: "11px", color: "rgba(251,191,36,0.7)", marginBottom: "16px" }}>⚠ {resultado.conflitos} horário(s) ignorado(s) por conflito.</p>}
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "16px" }}>
          <button onClick={() => { setForm(FORM_INICIAL); setStep(1); setResultado(null); }} style={{ padding: "10px 20px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: "8px", color: "#4ade80", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>NOVA RECORRÊNCIA</button>
          <button onClick={onClose} style={{ padding: "10px 20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.4)", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>FECHAR</button>
        </div>
      </div>
    </ModalBase>
  );

  return (
    <ModalBase onClose={onClose} maxWidth="500px">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "20px" }}>
        <div>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", letterSpacing: "0.12em", marginBottom: "4px" }}>↺ RESERVA RECORRENTE</p>
          <h1 style={{ fontFamily: serif, fontSize: "22px", color: "#4ade80" }}>Nova Recorrência</h1>
        </div>
        <BtnClose onClick={onClose} />
      </div>
      <StepDot step={step} />
      <div style={{ minHeight: "240px" }}>
        {step === 1 && <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div><p style={sectionLabel}>DIA DA SEMANA</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px" }}>{DAYS_CONFIG.map(d => <SelectCard key={d.diaSemana} label={d.labelFull} sublabel={d.slots.join(" · ")} selected={form.diaSemana === d.diaSemana} onClick={() => setForm(f => ({ ...f, diaSemana: d.diaSemana, horarioInicio: "" }))} />)}</div></div>
          {form.diaSemana && <div><p style={sectionLabel}>HORÁRIO</p><div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>{dayConfig.slots.map(s => <SelectCard key={s} label={s} sublabel={`até ${getHorarioFim(s)}`} selected={form.horarioInicio === s} onClick={() => setForm(f => ({ ...f, horarioInicio: s }))} />)}</div></div>}
          {form.horarioInicio && <div><p style={sectionLabel}>CAMPO</p><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "7px" }}>{campos.map(c => <SelectCard key={c.id} label={c.nome} selected={form.campoId === c.id} onClick={() => setForm(f => ({ ...f, campoId: c.id }))} />)}</div></div>}
        </div>}
        {step === 2 && <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <InputField label="NOME DO TIME / RESPONSÁVEL" required value={form.nomeTime} onChange={v => setForm(f => ({ ...f, nomeTime: v }))} placeholder="Ex: Os Crias FC" />
          <InputField label="TELEFONE (opcional)" value={form.telefone} onChange={v => setForm(f => ({ ...f, telefone: v }))} placeholder="Ex: 44 99999-1111" />
        </div>}
        {step === 3 && <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div><p style={sectionLabel}>DURAÇÃO</p><div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <SelectCard label="Indefinido" sublabel="Até cancelar manualmente" selected={form.tipoDuracao === "indefinido"} onClick={() => setForm(f => ({ ...f, tipoDuracao: "indefinido", dataFim: "" }))} />
            <SelectCard label="Até uma data" sublabel="Define quando encerra" selected={form.tipoDuracao === "data_fim"} onClick={() => setForm(f => ({ ...f, tipoDuracao: "data_fim" }))} />
          </div></div>
          {form.tipoDuracao === "data_fim" && <InputField label="DATA DE ENCERRAMENTO" required type="date" value={form.dataFim} onChange={v => setForm(f => ({ ...f, dataFim: v }))} />}
          <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: "8px", padding: "12px 14px" }}>
            <p style={{ fontSize: "10px", color: "rgba(251,191,36,0.8)", letterSpacing: "0.06em", marginBottom: "4px" }}>⚠ ATENÇÃO</p>
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>Serão geradas reservas para as próximas 8 semanas. Cancelar uma ocorrência não afeta as demais.</p>
          </div>
        </div>}
        {step === 4 && <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ ...sectionLabel, marginBottom: "10px" }}>RESUMO</p>
            {[["Time", form.nomeTime], ["Campo", campos.find(c => c.id === form.campoId)?.nome], ["Dia", DAYS_CONFIG.find(d => d.diaSemana === form.diaSemana)?.labelFull], ["Horário", `${form.horarioInicio} – ${getHorarioFim(form.horarioInicio)}`], ["Duração", form.tipoDuracao === "indefinido" ? "Indefinida" : `Até ${form.dataFim}`]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "7px", marginBottom: "7px" }}>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>{l}</span>
                <span style={{ fontSize: "11px", color: "#fff", fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>}
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "18px" }}>
        <button onClick={() => step > 1 ? setStep(s => s - 1) : onClose()} style={{ padding: "10px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.4)", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>
          {step > 1 ? "‹ VOLTAR" : "CANCELAR"}
        </button>
        {step < 4
          ? <button onClick={() => setStep(s => s + 1)} disabled={!canAdv(step, form)} style={{ flex: 1, padding: "10px", background: canAdv(step, form) ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${canAdv(step, form) ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "8px", color: canAdv(step, form) ? "#4ade80" : "rgba(255,255,255,0.2)", fontSize: "11px", cursor: canAdv(step, form) ? "pointer" : "not-allowed", fontFamily: mono, fontWeight: 600 }}>PRÓXIMO ›</button>
          : <button onClick={handleSalvar} disabled={loading} style={{ flex: 1, padding: "10px", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: "8px", color: "#4ade80", fontSize: "11px", cursor: loading ? "not-allowed" : "pointer", fontFamily: mono, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              {loading ? <><Spinner />SALVANDO...</> : "✓ CONFIRMAR RECORRÊNCIA"}
            </button>
        }
      </div>
    </ModalBase>
  );
}

// ─── SLOT CELL ────────────────────────────────────────────────────────────────
function SlotCell({ reserva, onClickLivre, onClickReserva }) {
  const [hov, setHov] = useState(false);
  if (!reserva) return (
    <button onClick={onClickLivre} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.03)", border: `1px dashed ${hov ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`, borderRadius: "6px", color: hov ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.2)", fontSize: "10px", cursor: "pointer", width: "100%", height: "52px", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "0.05em", fontFamily: mono }}>
      + LIVRE
    </button>
  );
  return (
    <div onClick={() => onClickReserva(reserva)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? "linear-gradient(135deg,rgba(74,222,128,0.25),rgba(34,197,94,0.15))" : "linear-gradient(135deg,rgba(74,222,128,0.15),rgba(34,197,94,0.08))", border: `1px solid ${hov ? "rgba(74,222,128,0.6)" : "rgba(74,222,128,0.35)"}`, borderRadius: "6px", padding: "6px", height: "52px", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px", transition: "all 0.15s", position: "relative", overflow: "hidden" }}>
      {reserva.recorrenciaId && <span style={{ position: "absolute", top: 3, right: 5, fontSize: "9px", color: "rgba(74,222,128,0.6)" }}>↺</span>}
      <span style={{ fontSize: "10px", fontWeight: 700, color: "#4ade80", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reserva.nomeTime}</span>
      {reserva.telefone && <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)" }}>{reserva.telefone}</span>}
    </div>
  );
}

// ─── TELA AGENDA ──────────────────────────────────────────────────────────────
function TelaAgenda() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reservas, setReservas]       = useState([]);
  const [loadingReservas, setLoadingReservas] = useState(false);
  const [modalReserva, setModalReserva]           = useState(null);
  const [modalNovoSlot, setModalNovoSlot]         = useState(null);
  const [modalRecorrencia, setModalRecorrencia]   = useState(false);
  const [modalResumo, setModalResumo]             = useState(false);

  const weekDates  = getWeekDates(currentDate);
  const weekLabel  = formatWeekLabel(weekDates);
  const totalRes   = reservas.filter(r => !r.cancelada).length;
  const totalSlots = weekDates.reduce((acc, d) => acc + d.slots.length * 9, 0);

  // ── Busca reservas toda vez que a semana muda ──
  const carregarReservas = useCallback(async () => {
    setLoadingReservas(true);
    try {
      const data = await getReservasDaSemana(weekDates);
      setReservas(data);
    } catch (err) {
      console.error("Erro ao carregar reservas:", err);
    } finally {
      setLoadingReservas(false);
    }
  }, [currentDate]); // eslint-disable-line

  useEffect(() => { carregarReservas(); }, [carregarReservas]);

  const prevWeek = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); };
  const nextWeek = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); };

  // ── Handlers que chamam o Firestore ──
  const handleCancelarReserva = async (reservaId) => {
    const result = await cancelarReserva(reservaId);
    if (result.sucesso) await carregarReservas();
    return result;
  };

  const handleSalvarAvulsa = async (dados) => {
    const result = await criarReserva(dados);
    if (result.sucesso) await carregarReservas();
    return result;
  };

  const handleSalvarRecorrencia = async (form) => {
    const result = await criarRecorrencia(form);
    if (result.sucesso) await carregarReservas();
    return result;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080d08", fontFamily: mono, color: "#fff", padding: "24px" }}>
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", flexWrap: "wrap", gap: "14px" }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: "26px", color: "#4ade80", lineHeight: 1 }}>Arena Schedule</h1>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "4px", letterSpacing: "0.08em" }}>
            {loadingReservas ? "carregando..." : `${totalRes} RESERVAS · ${totalSlots - totalRes} LIVRES ESSA SEMANA`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => setModalResumo(true)} style={{ padding: "8px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "7px", color: "rgba(255,255,255,0.6)", fontSize: "11px", cursor: "pointer", fontFamily: mono, letterSpacing: "0.06em" }}>☰ RESUMO</button>
          <button onClick={() => setModalRecorrencia(true)} style={{ padding: "8px 14px", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: "7px", color: "#4ade80", fontSize: "11px", cursor: "pointer", fontFamily: mono, fontWeight: 600, letterSpacing: "0.06em" }}>↺ RECORRÊNCIA</button>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button onClick={prevWeek} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff", width: "32px", height: "32px", cursor: "pointer", fontSize: "14px" }}>‹</button>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", minWidth: "150px", textAlign: "center" }}>{weekLabel}</span>
            <button onClick={nextWeek} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff", width: "32px", height: "32px", cursor: "pointer", fontSize: "14px" }}>›</button>
          </div>
          <button onClick={() => signOut(auth)} style={{ padding: "8px 12px", background: "transparent", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "7px", color: "rgba(239,68,68,0.5)", fontSize: "10px", cursor: "pointer", fontFamily: mono, letterSpacing: "0.06em" }}>SAIR</button>
        </div>
      </div>

      {/* GRID */}
      <div style={{ overflowX: "auto", opacity: loadingReservas ? 0.4 : 1, transition: "opacity 0.2s" }}>
        <div style={{ minWidth: "860px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px repeat(9,1fr)", gap: "6px", marginBottom: "6px" }}>
            <div />
            {campos.map(c => <div key={c.id} style={{ textAlign: "center", fontSize: "10px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", paddingBottom: "4px", borderBottom: "1px solid rgba(74,222,128,0.2)" }}>{c.nome.toUpperCase()}</div>)}
          </div>
          {weekDates.map(day => (
            <div key={day.dateStr} style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <div style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#4ade80", fontWeight: 600, minWidth: "30px" }}>{day.label}</div>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)" }}>{day.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
                <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
              </div>
              {day.slots.map(slot => (
                <div key={slot} style={{ display: "grid", gridTemplateColumns: "80px repeat(9,1fr)", gap: "6px", marginBottom: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "10px" }}>
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>{slot}</span>
                  </div>
                  {campos.map(campo => {
                    const reserva = getReservaLocal(reservas, campo.id, day.dateStr, slot);
                    return <SlotCell key={campo.id} reserva={reserva} onClickLivre={() => setModalNovoSlot({ campoId: campo.id, dateStr: day.dateStr, horario: slot })} onClickReserva={setModalReserva} />;
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* LEGENDA */}
      <div style={{ display: "flex", gap: "20px", marginTop: "8px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {[{ color: "rgba(74,222,128,0.35)", label: "Reservado" }, { color: "rgba(255,255,255,0.1)", label: "Livre", dashed: true }].map(({ color, label, dashed }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "14px", height: "14px", borderRadius: "3px", background: color, border: dashed ? "1px dashed rgba(255,255,255,0.2)" : "none" }} />
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em" }}>{label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "rgba(74,222,128,0.6)" }}>↺</span>
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em" }}>Recorrente</span>
        </div>
      </div>

      {/* MODAIS */}
      {modalReserva    && <ModalReserva    reserva={modalReserva}  onClose={() => setModalReserva(null)}    onCancelar={handleCancelarReserva} />}
      {modalNovoSlot   && <ModalNovaReserva slot={modalNovoSlot}   onClose={() => setModalNovoSlot(null)}   onSalvar={handleSalvarAvulsa} />}
      {modalRecorrencia && <ModalRecorrencia                        onClose={() => setModalRecorrencia(false)} onSalvar={handleSalvarRecorrencia} />}
      {modalResumo     && <ModalResumo weekDates={weekDates} reservas={reservas} weekLabel={weekLabel} onClose={() => setModalResumo(false)} />}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState(undefined); // undefined = verificando
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // onAuthStateChanged cuida do estado de login automaticamente,
    // inclusive quando a página é recarregada (sessão persistida pelo Firebase)
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return unsub; // cleanup
  }, []);

  if (checking) return (
    <div style={{ minHeight: "100vh", background: "#080d08", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spinner />
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#080d08}
        ::-webkit-scrollbar-thumb{background:rgba(74,222,128,0.3);border-radius:4px}
      `}</style>
      {user ? <TelaAgenda user={user} /> : <TelaLogin />}
    </>
  );
}
