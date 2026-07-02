import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://ykygszjqqnkgqjowbanj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlreWdzempxcW5rZ3Fqb3diYW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMDMsImV4cCI6MjA5NTk4NzEwM30.K24YPH1WeN7eUGpG2OJqfxYCYfNFm5DOxwWiictT_3Y";

const ORDERS_KEY  = "mdf_orders_v8";
const HISTORY_KEY = "mdf_history_v1";
const PIN = "1234";
const ARCHIVE_AFTER_MIN = 60;

const STAGES = [
  { key: "activo",     label: "Pedidos activos", dot: "#64748B", bg: "#F1F5F9", fg: "#1E293B", border: "#CBD5E1" },
  { key: "corte",      label: "Corte",           dot: "#EF4444", bg: "#FEE2E2", fg: "#7F1D1D", border: "#EF4444" },
  { key: "canteo",     label: "Canteo",          dot: "#F59E0B", bg: "#FEF3C7", fg: "#78350F", border: "#F59E0B" },
  { key: "completado", label: "Completados",     dot: "#22C55E", bg: "#DCFCE7", fg: "#14532D", border: "#22C55E" },
];
const SEQ = ["activo", "corte", "canteo", "completado"];
const NEXT_LABEL = { activo: "Enviar a Corte", corte: "Enviar a Canteo", canteo: "Marcar Completo" };
const NEXT_COLOR = { activo: "#EF4444", corte: "#F59E0B", canteo: "#22C55E" };

const EMPTY_ORDERS  = { orders: [], nextId: 1 };
const EMPTY_HISTORY = { items: [] };

async function sbGet(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mdf_pedidos?key=eq.${key}&select=value`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  if (data && data.length > 0) return JSON.parse(data[0].value);
  return null;
}

async function sbSet(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/mdf_pedidos`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() })
  });
}

function Dot({ color, size = 9 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, flexShrink:0 }} />;
}

function fmt(ms) {
  if (!ms || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? `${h}h ${rm}min` : `${h}h`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h}h`;
}

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts), n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

export default function App() {
  const [data, setData]             = useState(null);
  const [history, setHistory]       = useState(null);
  const [mode, setMode]             = useState("operario");
  const [view, setView]             = useState("monitor");
  const [toast, setToast]           = useState(null);
  const [confirmPin, setConfirmPin] = useState(false);
  const [pinInput, setPinInput]     = useState("");
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ cliente: "", observaciones: "" });
  const [now, setNow]               = useState(Date.now());

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const loadData = useCallback(async () => {
    try { const r = await sbGet(ORDERS_KEY); setData(r || EMPTY_ORDERS); }
    catch { setData(d => d || EMPTY_ORDERS); }
  }, []);

  const loadHistory = useCallback(async () => {
    try { const r = await sbGet(HISTORY_KEY); setHistory(r || EMPTY_HISTORY); }
    catch { setHistory(h => h || EMPTY_HISTORY); }
  }, []);

  const saveData = useCallback(async (next) => {
    setData(next);
    try { await sbSet(ORDERS_KEY, next); }
    catch (e) { showToast("Error al guardar: " + (e?.message || ""), "err"); }
  }, []);

  const saveHistory = useCallback(async (next) => {
    setHistory(next);
    try { await sbSet(HISTORY_KEY, next); }
    catch { showToast("Error al guardar historial", "err"); }
  }, []);

  useEffect(() => {
    loadData(); loadHistory();
    const id = setInterval(() => { loadData(); loadHistory(); }, 5000);
    return () => clearInterval(id);
  }, [loadData, loadHistory]);

  useEffect(() => {
    if (!data || !history) return;
    const cutoff = Date.now() - ARCHIVE_AFTER_MIN * 60 * 1000;
    const toArchive = data.orders.filter(o => o.stage === "completado" && o.timestamps?.completado && o.timestamps.completado < cutoff);
    if (toArchive.length === 0) return;
    const remaining = data.orders.filter(o => !toArchive.find(a => a.id === o.id));
    saveData({ ...data, orders: remaining });
    saveHistory({ items: [...toArchive, ...history.items] });
  }, [now, data, history]);

  const addOrder = () => {
    if (!form.cliente.trim()) { showToast("Ingresá el nombre del cliente", "err"); return; }
    const ts = Date.now();
    const order = {
      id: data.nextId,
      numero: `PED-${String(data.nextId).padStart(4, "0")}`,
      cliente: form.cliente.trim(),
      observaciones: form.observaciones.trim(),
      stage: "activo",
      hora: new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      timestamps: { activo: ts },
    };
    saveData({ orders: [...data.orders, order], nextId: data.nextId + 1 });
    setForm({ cliente: "", observaciones: "" });
    setShowForm(false);
    showToast(`${order.numero} cargado`);
  };

  const advance = (id) => {
    const ts = Date.now();
    saveData({ ...data, orders: data.orders.map(o => {
      if (o.id !== id) return o;
      const i = SEQ.indexOf(o.stage);
      if (i >= SEQ.length - 1) return o;
      const nextStage = SEQ[i + 1];
      return { ...o, stage: nextStage, timestamps: { ...o.timestamps, [nextStage]: ts } };
    })});
  };

  const goBack = (id) => {
    saveData({ ...data, orders: data.orders.map(o => {
      if (o.id !== id) return o;
      const i = SEQ.indexOf(o.stage);
      if (i <= 0) return o;
      const prev = SEQ[i - 1];
      const ts = { ...o.timestamps };
      delete ts[o.stage];
      return { ...o, stage: prev, timestamps: ts };
    })});
  };

  const deleteOrder = (id) => {
    saveData({ ...data, orders: data.orders.filter(o => o.id !== id) });
    showToast("Pedido eliminado");
  };

  const archiveNow = (id) => {
    const order = data.orders.find(o => o.id === id);
    if (!order) return;
    saveData({ ...data, orders: data.orders.filter(o => o.id !== id) });
    saveHistory({ items: [order, ...history.items] });
    showToast("Movido al historial");
  };

  const clearHistory = () => {
    if (!window.confirm("¿Borrar todo el historial?")) return;
    saveHistory(EMPTY_HISTORY);
    showToast("Historial borrado");
  };

  const tryGestion = () => { setConfirmPin(true); setPinInput(""); };
  const checkPin = () => {
    if (pinInput === PIN) { setMode("gestion"); setConfirmPin(false); }
    else { showToast("PIN incorrecto", "err"); setPinInput(""); }
  };

  const todayOrders = [...(data?.orders || []), ...(history?.items || [])].filter(o => isToday(o.timestamps?.activo));
  const completedToday = todayOrders.filter(o => o.stage === "completado");

  function avgTime(orders, from, to) {
    const times = orders.map(o => o.timestamps?.[to] && o.timestamps?.[from] ? o.timestamps[to] - o.timestamps[from] : null).filter(Boolean);
    if (!times.length) return null;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  const avgCorte  = avgTime(completedToday, "corte", "canteo");
  const avgCanteo = avgTime(completedToday, "canteo", "completado");
  const avgTotal  = avgTime(completedToday, "activo", "completado");

  if (!data || !history) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8", fontSize: 14 }}>⏳ Cargando...</div>
  );

  const byStage = key => data.orders.filter(o => o.stage === key);
  const historyToday = history.items.filter(o => isToday(o.timestamps?.activo));
  const historyOld   = history.items.filter(o => !isToday(o.timestamps?.activo));
  const inp = { fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ fontFamily: "system-ui", padding: "0.875rem 0", maxWidth: 860, margin: "0 auto" }}>

      {toast && (
        <div style={{ position: "sticky", top: 0, zIndex: 20, marginBottom: 12, background: toast.type === "err" ? "#FEE2E2" : "#DCFCE7", color: toast.type === "err" ? "#7F1D1D" : "#14532D", padding: "0.5rem 1rem", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>{toast.msg}</div>
      )}

      {confirmPin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Acceso a Gestión</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Ingresá el PIN para continuar</div>
            <input type="password" placeholder="PIN" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === "Enter" && checkPin()} style={{ ...inp, fontSize: 20, textAlign: "center", letterSpacing: 8, marginBottom: 12 }} autoFocus />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={checkPin} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 14, padding: "8px", borderRadius: 8, cursor: "pointer" }}>Entrar</button>
              <button onClick={() => setConfirmPin(false)} style={{ fontSize: 14, padding: "8px 14px", cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>📋 Monitor de producción</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Tiempo real · se actualiza cada 5 seg</div>
        </div>
        <div>
          {mode === "operario" ? (
            <button onClick={tryGestion} style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>⚙ Gestión</button>
          ) : (
            <button onClick={() => { setMode("operario"); setShowForm(false); setView("monitor"); }} style={{ fontSize: 12, padding: "5px 12px", background: "#FEF3C7", color: "#78350F", border: "1px solid #F59E0B", cursor: "pointer" }}>← Operario</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: "1.25rem", background: "#F1F5F9", borderRadius: 10, padding: 3 }}>
        {[{ key: "monitor", label: "Monitor" }, { key: "resumen", label: "Resumen del día" }, { key: "historial", label: `Historial (${history.items.length})` }].map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: "7px 8px", background: view === v.key ? "#fff" : "transparent", color: view === v.key ? "#1E293B" : "#64748B", border: "none", borderRadius: 8, boxShadow: view === v.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none", cursor: "pointer" }}>{v.label}</button>
        ))}
      </div>

      {view === "monitor" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: "1.25rem" }}>
            {STAGES.map(s => (
              <div key={s.key} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 12, padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.fg, lineHeight: 1 }}>{byStage(s.key).length}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: s.fg, marginTop: 4, opacity: 0.85 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {mode === "gestion" && (
            <div style={{ marginBottom: "1.25rem" }}>
              {!showForm ? (
                <button onClick={() => setShowForm(true)} style={{ width: "100%", padding: "10px", background: "#1E293B", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Nuevo pedido</button>
              ) : (
                <div style={{ background: "#F8FAFC", border: "1.5px solid #3B82F6", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Nuevo pedido</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input placeholder="Cliente *" value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} style={inp} autoFocus />
                    <textarea placeholder="Observaciones: anotá las placas, cantidades, materiales, medidas..." value={form.observaciones} onChange={e => setForm({ ...form, observaciones: e.target.value })} rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={addOrder} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, padding: "9px", borderRadius: 8, cursor: "pointer" }}>Cargar pedido</button>
                    <button onClick={() => { setShowForm(false); setForm({ cliente: "", observaciones: "" }); }} style={{ fontSize: 13, padding: "9px 14px", cursor: "pointer" }}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {STAGES.map(stage => {
            const items = byStage(stage.key);
            return (
              <div key={stage.key} style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Dot color={stage.dot} size={10} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: stage.fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stage.label}</span>
                  <span style={{ fontSize: 12, background: stage.bg, color: stage.fg, padding: "1px 8px", borderRadius: 99, fontWeight: 700 }}>{items.length}</span>
                  {stage.key === "completado" && items.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8" }}>Se archivan en {ARCHIVE_AFTER_MIN} min</span>
                  )}
                </div>
                {items.length === 0 ? (
                  <div style={{ border: `1px dashed ${stage.border}`, borderRadius: 10, padding: "1.25rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Sin pedidos</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map(order => {
                      const stageTs = order.timestamps?.[order.stage];
                      const elapsed = stageTs ? Date.now() - stageTs : null;
                      return (
                        <div key={order.id} style={{ background: "#fff", border: `1.5px solid ${stage.border}`, borderRadius: 12, overflow: "hidden" }}>
                          <div style={{ padding: "0.875rem 1rem" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>{order.numero}</span>
                              <span style={{ fontSize: 15, color: "#1E293B", fontWeight: 500 }}>{order.cliente}</span>
                              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8" }}>{order.hora} · {timeAgo(stageTs)}</span>
                            </div>
                            {order.observaciones && (
                              <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6, background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", borderLeft: `3px solid ${stage.border}`, whiteSpace: "pre-wrap" }}>
                                {order.observaciones}
                              </div>
                            )}
                            {elapsed && elapsed > 0 && (
                              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>⏱ {fmt(elapsed)} en esta etapa</div>
                            )}
                          </div>
                          <div style={{ borderTop: `1px solid ${stage.bg}`, padding: "0.5rem 1rem", background: stage.bg, display: "flex", gap: 6, alignItems: "center" }}>
                            {mode === "gestion" && order.stage !== "activo" && (
                              <button onClick={() => goBack(order.id)} style={{ fontSize: 12, padding: "4px 10px", color: "#64748B", cursor: "pointer" }}>← Atrás</button>
                            )}
                            {order.stage !== "completado" ? (
                              <button onClick={() => advance(order.id)} style={{ flex: 1, fontSize: 13, fontWeight: 700, padding: "7px 12px", background: NEXT_COLOR[order.stage], color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                                {NEXT_LABEL[order.stage]}
                              </button>
                            ) : (
                              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#14532D", textAlign: "center" }}>✓ Finalizado</div>
                            )}
                            {mode === "gestion" && (
                              <>
                                {order.stage === "completado" && (
                                  <button onClick={() => archiveNow(order.id)} title="Archivar ahora" style={{ fontSize: 12, padding: "4px 8px", color: "#3B82F6", cursor: "pointer" }}>📁</button>
                                )}
                                <button onClick={() => deleteOrder(order.id)} style={{ fontSize: 12, padding: "4px 8px", color: "#EF4444", cursor: "pointer" }}>🗑</button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {view === "resumen" && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: "1rem" }}>
            📊 Resumen del día — {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1.5rem" }}>
            {[
              { label: "Pedidos ingresados hoy",  value: todayOrders.length,      color: "#64748B" },
              { label: "Pedidos completados hoy", value: completedToday.length,   color: "#22C55E" },
              { label: "En proceso ahora",        value: data.orders.filter(o => o.stage !== "completado").length, color: "#3B82F6" },
              { label: "Esperando en cola",       value: byStage("activo").length, color: "#F59E0B" },
            ].map((k, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>{k.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tiempos promedio por etapa</div>
          {completedToday.length === 0 ? (
            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "1.5rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Todavía no hay pedidos completados hoy para calcular tiempos.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.5rem" }}>
              {[
                { label: "⏱ Tiempo en Corte",         value: avgCorte,  color: "#EF4444", bg: "#FEE2E2" },
                { label: "⏱ Tiempo en Canteo",        value: avgCanteo, color: "#F59E0B", bg: "#FEF3C7" },
                { label: "⏱ Tiempo total por pedido", value: avgTotal,  color: "#22C55E", bg: "#DCFCE7" },
              ].map((t, i) => (
                <div key={i} style={{ background: t.bg, borderRadius: 10, padding: "0.875rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#1E293B", fontWeight: 500 }}>{t.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: t.color }}>{fmt(t.value)}</span>
                </div>
              ))}
            </div>
          )}
          {completedToday.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Pedidos completados hoy ({completedToday.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {completedToday.map(order => {
                  const total = order.timestamps?.completado && order.timestamps?.activo ? order.timestamps.completado - order.timestamps.activo : null;
                  return (
                    <div key={order.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{order.numero} · {order.cliente}</div>
                        {order.observaciones && <div style={{ fontSize: 12, color: "#64748B", whiteSpace: "pre-wrap" }}>{order.observaciones}</div>}
                      </div>
                      {total && <div style={{ fontSize: 12, color: "#22C55E", fontWeight: 700, flexShrink: 0 }}>{fmt(total)}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {view === "historial" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>🗂 Historial de pedidos</div>
            {mode === "gestion" && history.items.length > 0 && (
              <button onClick={clearHistory} style={{ fontSize: 12, padding: "5px 12px", color: "#EF4444", cursor: "pointer" }}>🗑 Borrar todo</button>
            )}
          </div>
          {history.items.length === 0 ? (
            <div style={{ border: "1px dashed #CBD5E1", borderRadius: 10, padding: "2.5rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🗂</div>
              El historial está vacío. Los pedidos completados aparecen acá después de {ARCHIVE_AFTER_MIN} minutos.
            </div>
          ) : (
            <>
              {historyToday.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Hoy ({historyToday.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {historyToday.map(order => <HistoryCard key={order.id} order={order} />)}
                  </div>
                </div>
              )}
              {historyOld.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Anteriores ({historyOld.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {historyOld.map(order => <HistoryCard key={order.id} order={order} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryCard({ order }) {
  const total = order.timestamps?.completado && order.timestamps?.activo ? order.timestamps.completado - order.timestamps.activo : null;
  const fechaCompleto = order.timestamps?.completado
    ? new Date(order.timestamps.completado).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : order.hora;
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "0.75rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94A3B8" }}>{order.numero}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>{order.cliente}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8" }}>{fechaCompleto}</span>
        {total && (
          <span style={{ fontSize: 11, background: "#DCFCE7", color: "#14532D", padding: "1px 7px", borderRadius: 99, fontWeight: 600 }}>
            {fmt(total)} total
          </span>
        )}
      </div>
      {order.observaciones && (
        <div style={{ fontSize: 12, color: "#64748B", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{order.observaciones}</div>
      )}
    </div>
  );
}
