import { useState, useEffect, useCallback, useRef } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────
const ORDERS_KEY  = "mdf_orders_v8";
const HISTORY_KEY = "mdf_history_v1";
const PIN               = "1234";
const ARCHIVE_AFTER_MIN = 1440;
const HOLD_MS           = 800;
const TICK_MS           = 20;

const STAGES = [
  { key: "activo",      label: "Activos",     short: "Activos", dot: "#64748B", bg: "#F1F5F9", fg: "#1E293B", border: "#CBD5E1" },
  { key: "preparacion", label: "Preparación", short: "Prep.",   dot: "#6366F1", bg: "#EEF2FF", fg: "#312E81", border: "#6366F1" },
  { key: "corte",       label: "Corte",       short: "Corte",   dot: "#EF4444", bg: "#FEE2E2", fg: "#7F1D1D", border: "#EF4444" },
  { key: "cola_canteo", label: "Cola Canteo", short: "Cola",    dot: "#F97316", bg: "#FFF7ED", fg: "#7C2D12", border: "#F97316" },
  { key: "canteo",      label: "Canteo",      short: "Canteo",  dot: "#F59E0B", bg: "#FEF3C7", fg: "#78350F", border: "#F59E0B" },
  { key: "completado",  label: "Completados", short: "Listo",   dot: "#22C55E", bg: "#DCFCE7", fg: "#14532D", border: "#22C55E" },
];

const SEQ_CON    = ["activo", "preparacion", "corte", "cola_canteo", "canteo", "completado"];
const SEQ_SIN    = ["activo", "preparacion", "corte", "completado"];

const PAYMENT_OPTS = [
  { key: "sin_pago", label: "Sin pago",     dot: "#EF4444", bg: "#FEE2E2", fg: "#7F1D1D" },
  { key: "parcial",  label: "Pago parcial", dot: "#F59E0B", bg: "#FEF3C7", fg: "#78350F" },
  { key: "pagado",   label: "Pagado",       dot: "#22C55E", bg: "#DCFCE7", fg: "#14532D" },
];


const SUPABASE_URL = "https://ykygszjqqnkgqjowbanj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlreWdzempxcW5rZ3Fqb3diYW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMDMsImV4cCI6MjA5NTk4NzEwM30.K24YPH1WeN7eUGpG2OJqfxYCYfNFm5DOxwWiictT_3Y";

async function sbGet(key) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/mdf_pedidos?key=eq." + key + "&select=value", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
  });
  const data = await res.json();
  if (data && data.length > 0) return JSON.parse(data[0].value);
  return null;
}

async function sbSet(key, value) {
  await fetch(SUPABASE_URL + "/rest/v1/mdf_pedidos", {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key: key, value: JSON.stringify(value), updated_at: new Date().toISOString() })
  });
}

const EMPTY_ORDERS  = { orders: [], nextId: 1 };
const EMPTY_HISTORY = { items: [] };

// ── Utilidades ────────────────────────────────────────────────────────────────
function getSeq(order)      { return order.canto ? SEQ_CON : SEQ_SIN; }
function getNext(order)     { const s = getSeq(order), i = s.indexOf(order.stage); return i < s.length - 1 ? s[i + 1] : null; }
function getPrev(order)     { const s = getSeq(order), i = s.indexOf(order.stage); return i > 0 ? s[i - 1] : null; }
function getStageObj(key)   { return STAGES.find(s => s.key === key) || STAGES[0]; }
function getPayObj(key)     { return PAYMENT_OPTS.find(p => p.key === key) || PAYMENT_OPTS[0]; }

function fmt(ms) {
  if (!ms || ms <= 0) return "—";
  const total = Math.floor(ms / 60000);
  if (total < 1) return "<1 min";
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h > 0 ? h + "h " : ""}${m > 0 ? m + "min" : ""}`.trim();
  if (h > 0) return `${h}h${m > 0 ? " " + m + "min" : ""}`;
  return `${m} min`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)}h`;
}

function isToday(ts) {
  if (!ts) return false;
  const a = new Date(ts), b = new Date();
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function stageTime(order, from, to) {
  const a = order.timestamps?.[from], b = order.timestamps?.[to];
  return a && b && b > a ? b - a : null;
}

function calcAvg(arr)  { const v = arr.filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function calcMin(arr)  { const v = arr.filter(Boolean); return v.length ? Math.min(...v) : null; }
function calcMax(arr)  { const v = arr.filter(Boolean); return v.length ? Math.max(...v) : null; }

// ── Componentes simples ───────────────────────────────────────────────────────
function Dot({ color, size }) {
  return (
    <span style={{
      display: "inline-block",
      width: size || 9,
      height: size || 9,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
    }} />
  );
}

function HoldButton({ onAction, children, color, style }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding]   = useState(false);
  const timerRef  = useRef(null);
  const elapsed   = useRef(0);
  const btnColor  = color || "#22C55E";

  function start(e) {
    e.preventDefault();
    elapsed.current = 0;
    setProgress(0);
    setHolding(true);
    timerRef.current = setInterval(function() {
      elapsed.current += TICK_MS;
      const pct = Math.min((elapsed.current / HOLD_MS) * 100, 100);
      setProgress(pct);
      if (elapsed.current >= HOLD_MS) {
        clearInterval(timerRef.current);
        setHolding(false);
        setProgress(0);
        onAction();
      }
    }, TICK_MS);
  }

  function cancel() {
    clearInterval(timerRef.current);
    setHolding(false);
    setProgress(0);
    elapsed.current = 0;
  }

  return (
    <button
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={function(e) { e.preventDefault(); }}
      style={Object.assign({
        position: "relative",
        overflow: "hidden",
        background: btnColor,
        color: "#fff",
        border: "none",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        padding: "8px 12px",
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
      }, style || {})}
    >
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: progress + "%",
        background: "rgba(255,255,255,0.35)",
        pointerEvents: "none",
      }} />
      <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {holding ? <span style={{ fontSize: 11, opacity: 0.9 }}>Mantené presionado…</span> : children}
      </span>
    </button>
  );
}

function StatRow({ label, color, bg, values }) {
  const a  = calcAvg(values);
  const mn = calcMin(values);
  const mx = calcMax(values);
  const count = values.filter(Boolean).length;

  if (!a) {
    return (
      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#64748B" }}>{label}</span>
        <span style={{ fontSize: 12, color: "#CBD5E1" }}>Sin datos aún</span>
      </div>
    );
  }

  return (
    <div style={{ background: bg, borderRadius: 10, padding: "0.875rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Dot color={color} size={8} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{label}</span>
        </div>
        <span style={{ fontSize: 20, fontWeight: 800, color: color }}>{fmt(a)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        {[["Promedio", a], ["Mínimo", mn], ["Máximo", mx]].map(function(item) {
          return (
            <div key={item[0]} style={{ background: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#64748B", marginBottom: 2 }}>{item[0]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: color }}>{fmt(item[1])}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 6, textAlign: "right" }}>
        {count} pedido{count !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [orders,  setOrders]   = useState(null);
  const [history, setHistory]  = useState(null);
  const [mode,    setMode]     = useState("operario");
  const [view,    setView]     = useState("monitor");
  const [toast,   setToast]    = useState(null);
  const [pin,     setPin]      = useState(false);
  const [pinVal,  setPinVal]   = useState("");
  const [showForm,setShowForm] = useState(false);
  const [form,    setForm]     = useState({ cliente: "", observaciones: "", canto: false, cantidadPlacas: "" });
  const [expanded,setExpanded] = useState({});
  const [editing, setEditing]  = useState(null);
  const [editForm,setEditForm] = useState({ cliente: "", observaciones: "", canto: false });
  const [scope,   setScope]    = useState("hoy");
  const [filter,  setFilter]   = useState("todos");
  const [tick,    setTick]     = useState(Date.now());

  function toast_(msg, type) { setToast({ msg: msg, type: type || "ok" }); setTimeout(function() { setToast(null); }, 2800); }

  useEffect(function() {
    var id = setInterval(function() { setTick(Date.now()); }, 30000);
    return function() { clearInterval(id); };
  }, []);

  var loadOrders = useCallback(async function() {
    try {
      var r = await sbGet(ORDERS_KEY);
      if (r && Array.isArray(r.orders)) {
        setOrders(r);
      } else {
        setOrders(function(prev) { return prev || EMPTY_ORDERS; });
      }
    } catch(e) {
      setOrders(function(prev) { return prev || EMPTY_ORDERS; });
    }
  }, []);

  var loadHistory = useCallback(async function() {
    try {
      var r = await sbGet(HISTORY_KEY);
      if (r && Array.isArray(r.items)) {
        setHistory(r);
      } else {
        setHistory(function(prev) { return prev || EMPTY_HISTORY; });
      }
    } catch(e) {
      setHistory(function(prev) { return prev || EMPTY_HISTORY; });
    }
  }, []);

  var saveOrders = useCallback(async function(next) {
    setOrders(next);
    try { await sbSet(ORDERS_KEY, next); }
    catch(e) { toast_("Error al guardar: " + (e && e.message ? e.message : ""), "err"); }
  }, []);

  var saveHistory = useCallback(async function(next) {
    setHistory(next);
    try { await sbSet(HISTORY_KEY, next); }
    catch(e) { toast_("Error al guardar historial", "err"); }
  }, []);

  useEffect(function() {
    loadOrders();
    loadHistory();
    var id = setInterval(function() { loadOrders(); loadHistory(); }, 5000);
    return function() { clearInterval(id); };
  }, [loadOrders, loadHistory]);

  // Auto-archivar completados
  useEffect(function() {
    if (!orders || !history) return;
    var cutoff = Date.now() - ARCHIVE_AFTER_MIN * 60 * 1000;
    var toArchive = orders.orders.filter(function(o) {
      return o.stage === "completado" && o.timestamps && o.timestamps.completado && o.timestamps.completado < cutoff;
    });
    if (!toArchive.length) return;
    var ids = toArchive.map(function(o) { return o.id; });
    saveOrders(Object.assign({}, orders, { orders: orders.orders.filter(function(o) { return ids.indexOf(o.id) === -1; }) }));
    saveHistory({ items: toArchive.concat(history.items) });
  }, [tick, orders, history]);

  function addOrder() {
    if (!form.cliente.trim()) { toast_("Ingresá el nombre del cliente", "err"); return; }
    var ts  = Date.now();
    var id  = orders.nextId;
    var num = "PED-" + String(id).padStart(4, "0");
    var o = {
      id: id, numero: num,
      cliente: form.cliente.trim(),
      observaciones: form.observaciones.trim(),
      cantidadPlacas: parseInt(form.cantidadPlacas) || 0,
      canto: form.canto,
      stage: "activo",
      payment: "sin_pago",
      modified: false,
      hora: new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      timestamps: { activo: ts },
    };
    saveOrders({ orders: orders.orders.concat([o]), nextId: id + 1 });
    setForm({ cliente: "", observaciones: "", canto: false, cantidadPlacas: "" });
    setShowForm(false);
    toast_(num + " cargado");
  }

  function saveEdit(id) {
    if (!editForm.cliente.trim()) { toast_("El cliente no puede estar vacío", "err"); return; }
    saveOrders(Object.assign({}, orders, {
      orders: orders.orders.map(function(o) {
        if (o.id !== id) return o;
        return Object.assign({}, o, {
          cliente: editForm.cliente.trim(),
          observaciones: editForm.observaciones.trim(),
          canto: editForm.canto,
          modified: true,
          modifiedAt: Date.now(),
        });
      }),
    }));
    setEditing(null);
    toast_("Pedido actualizado");
  }

  function updatePayment(id, pay) {
    saveOrders(Object.assign({}, orders, {
      orders: orders.orders.map(function(o) { return o.id === id ? Object.assign({}, o, { payment: pay }) : o; }),
    }));
  }

  function advance(id) {
    var ts = Date.now();
    saveOrders(Object.assign({}, orders, {
      orders: orders.orders.map(function(o) {
        if (o.id !== id) return o;
        var next = getNext(o);
        if (!next) return o;
        var timestamps = Object.assign({}, o.timestamps);
        timestamps[next] = ts;
        return Object.assign({}, o, { stage: next, timestamps: timestamps });
      }),
    }));
  }

  function goBack(id) {
    saveOrders(Object.assign({}, orders, {
      orders: orders.orders.map(function(o) {
        if (o.id !== id) return o;
        var prev = getPrev(o);
        if (!prev) return o;
        var timestamps = Object.assign({}, o.timestamps);
        delete timestamps[o.stage];
        return Object.assign({}, o, { stage: prev, timestamps: timestamps });
      }),
    }));
  }

  function deleteOrder(id) {
    saveOrders(Object.assign({}, orders, { orders: orders.orders.filter(function(o) { return o.id !== id; }) }));
    toast_("Eliminado");
  }

  function archiveNow(id) {
    var order = orders.orders.find(function(o) { return o.id === id; });
    if (!order) return;
    saveOrders(Object.assign({}, orders, { orders: orders.orders.filter(function(o) { return o.id !== id; }) }));
    saveHistory({ items: [order].concat(history.items) });
    toast_("Movido al historial");
  }

  function clearHist() {
    if (!window.confirm("¿Borrar todo el historial?")) return;
    saveHistory(EMPTY_HISTORY);
    toast_("Historial borrado");
  }

  function openPin() { setPin(true); setPinVal(""); }
  function checkPin() {
    if (pinVal === PIN) { setMode("gestion"); setPin(false); }
    else { toast_("PIN incorrecto", "err"); setPinVal(""); }
  }

  function toggleExpand(id) { setExpanded(function(e) { return Object.assign({}, e, { [id]: !e[id] }); }); }

  if (!orders || !history) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>⏳ Cargando...</div>;
  }

  // Datos estadísticas
  var allDone    = orders.orders.filter(function(o) { return o.stage === "completado"; }).concat(history.items);
  var byScope    = scope === "hoy" ? allDone.filter(function(o) { return isToday(o.timestamps && o.timestamps.activo); }) : allDone;
  var byFilter   = filter === "canto" ? byScope.filter(function(o) { return o.canto; }) : filter === "sincanto" ? byScope.filter(function(o) { return !o.canto; }) : byScope;
  var wCanto     = byFilter.filter(function(o) { return o.canto; });
  var woCanto    = byFilter.filter(function(o) { return !o.canto; });
  var todayAll   = allDone.filter(function(o) { return isToday(o.timestamps && o.timestamps.activo); });

  var tPrep  = byFilter.map(function(o) { return stageTime(o, "preparacion", "corte"); });
  var tCorte = byFilter.map(function(o) { return o.canto ? stageTime(o, "corte", "cola_canteo") : stageTime(o, "corte", "completado"); });
  var tEsp   = wCanto.map(function(o) { return stageTime(o, "cola_canteo", "canteo"); });
  var tCant  = wCanto.map(function(o) { return stageTime(o, "canteo", "completado"); });
  var tTot   = byFilter.map(function(o) { return stageTime(o, "activo", "completado"); });

  var inp = { fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "0.875rem", maxWidth: 860, margin: "0 auto" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "sticky", top: 0, zIndex: 20, marginBottom: 12,
          background: toast.type === "err" ? "#FEE2E2" : "#DCFCE7",
          color: toast.type === "err" ? "#7F1D1D" : "#14532D",
          padding: "0.5rem 1rem", borderRadius: 10, fontSize: 13, fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Modal PIN */}
      {pin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Acceso a Gestión</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Ingresá el PIN para continuar</div>
            <input
              type="password" placeholder="PIN" value={pinVal} autoFocus
              onChange={function(e) { setPinVal(e.target.value); }}
              onKeyDown={function(e) { if (e.key === "Enter") checkPin(); }}
              style={Object.assign({}, inp, { fontSize: 20, textAlign: "center", letterSpacing: 8, marginBottom: 12 })}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={checkPin} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 14, padding: "8px", borderRadius: 8 }}>Entrar</button>
              <button onClick={function() { setPin(false); }} style={{ fontSize: 14, padding: "8px 14px" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>📋 Monitor de producción</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Tiempo real · cada 5 seg</div>
        </div>
        {mode === "operario"
          ? <button onClick={openPin} style={{ fontSize: 12, padding: "5px 12px" }}>⚙ Gestión</button>
          : <button onClick={function() { setMode("operario"); setShowForm(false); setEditing(null); setView("monitor"); }}
              style={{ fontSize: 12, padding: "5px 12px", background: "#FEF3C7", color: "#78350F", border: "1px solid #F59E0B" }}>
              ← Operario
            </button>
        }
      </div>

      {/* Navegación */}
      <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 10, padding: 3, marginBottom: "1.25rem" }}>
        {[["monitor", "Monitor"], ["resumen", "Estadísticas"], ["historial", "Historial (" + history.items.length + ")"]].map(function(item) {
          return (
            <button key={item[0]} onClick={function() { setView(item[0]); }} style={{
              flex: 1, fontSize: 12, fontWeight: 600, padding: "7px 8px",
              background: view === item[0] ? "#fff" : "transparent",
              color: view === item[0] ? "#1E293B" : "#64748B",
              border: "none", borderRadius: 8,
              boxShadow: view === item[0] ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
            }}>{item[1]}</button>
          );
        })}
      </div>

      {/* ══ MONITOR ══════════════════════════════════════════════════════════════ */}
      {view === "monitor" && (
        <div>
          {/* Contadores */}
          {/* Contadores — formato original */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: "1.25rem" }}>
            {STAGES.map(function(s) {
              var count = orders.orders.filter(function(o) { return o.stage === s.key; }).length;
              return (
                <div key={s.key} style={{ background: s.bg, border: "1.5px solid " + s.border, borderRadius: 12, padding: "0.6rem 0.75rem", textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: s.fg, lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: s.fg, marginTop: 3, opacity: 0.85 }}>{s.short}</div>
                </div>
              );
            })}
          </div>

          {/* Resumen de placas — solo visible en modo gestión */}
          {mode === "gestion" && (
            <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                📦 Placas en producción
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {STAGES.filter(function(s) { return s.key !== "completado"; }).map(function(s) {
                  var total = orders.orders.filter(function(o) { return o.stage === s.key; }).reduce(function(sum, o) { return sum + (o.cantidadPlacas || 0); }, 0);
                  return (
                    <div key={s.key} style={{ background: "#fff", borderRadius: 8, padding: "6px 8px", textAlign: "center", border: "1px solid #DBEAFE" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.dot, lineHeight: 1 }}>{total}</div>
                      <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{s.short}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "#1D4ED8", marginTop: 8, textAlign: "right", fontWeight: 500 }}>
                Total en proceso: {orders.orders.filter(function(o) { return o.stage !== "completado"; }).reduce(function(sum, o) { return sum + (o.cantidadPlacas || 0); }, 0)} placas
              </div>
            </div>
          )}

          {/* Nuevo pedido (solo gestión) */}
          {mode === "gestion" && (
            <div style={{ marginBottom: "1.25rem" }}>
              {!showForm ? (
                <button onClick={function() { setShowForm(true); }}
                  style={{ width: "100%", padding: "10px", background: "#1E293B", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600 }}>
                  + Nuevo pedido
                </button>
              ) : (
                <div style={{ background: "#F8FAFC", border: "1.5px solid #3B82F6", borderRadius: 12, padding: "1rem" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Nuevo pedido</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input placeholder="Cliente *" value={form.cliente} onChange={function(e) { setForm(Object.assign({}, form, { cliente: e.target.value })); }} style={inp} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Cantidad de placas *</div>
                        <input
                          type="number" min="1" placeholder="ej: 12"
                          value={form.cantidadPlacas}
                          onChange={function(e) { setForm(Object.assign({}, form, { cantidadPlacas: e.target.value })); }}
                          style={Object.assign({}, inp, { fontSize: 20, fontWeight: 700, textAlign: "center" })}
                        />
                      </div>
                      {form.cantidadPlacas && (
                        <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 10, padding: "10px 16px", textAlign: "center", flexShrink: 0 }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: "#1D4ED8", lineHeight: 1 }}>{form.cantidadPlacas}</div>
                          <div style={{ fontSize: 11, color: "#1D4ED8", marginTop: 3 }}>placas</div>
                        </div>
                      )}
                    </div>
                    <textarea
                      placeholder="Observaciones: placas, cantidades, materiales, medidas..."
                      value={form.observaciones}
                      onChange={function(e) { setForm(Object.assign({}, form, { observaciones: e.target.value })); }}
                      rows={4}
                      style={Object.assign({}, inp, { resize: "vertical", lineHeight: 1.5 })}
                    />
                    <label style={{
                      display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none",
                      padding: "10px 12px", borderRadius: 10,
                      border: "2px solid " + (form.canto ? "#7C3AED" : "#E2E8F0"),
                      background: form.canto ? "#EDE9FE" : "#F8FAFC",
                    }}>
                      <input type="checkbox" checked={form.canto}
                        onChange={function(e) { setForm(Object.assign({}, form, { canto: e.target.checked })); }}
                        style={{ width: 18, height: 18, accentColor: "#7C3AED", cursor: "pointer", flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: form.canto ? "#4C1D95" : "#1E293B" }}>
                          {form.canto ? "✓ Lleva canto" : "Sin canto"}
                        </div>
                        <div style={{ fontSize: 11, color: form.canto ? "#6D28D9" : "#94A3B8", marginTop: 1 }}>
                          {form.canto ? "→ Cola Canteo → Canteo" : "→ Corte → Listo (saltea Canteo)"}
                        </div>
                      </div>
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={addOrder} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, padding: "9px", borderRadius: 8 }}>
                      Cargar pedido
                    </button>
                    <button onClick={function() { setShowForm(false); setForm({ cliente: "", observaciones: "", canto: false, cantidadPlacas: "" }); }} style={{ fontSize: 13, padding: "9px 14px" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Etapas */}
          {STAGES.map(function(stage) {
            var items = orders.orders.filter(function(o) { return o.stage === stage.key; });
            return (
              <div key={stage.key} style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Dot color={stage.dot} size={10} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: stage.fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stage.label}</span>
                  <span style={{ fontSize: 12, background: stage.bg, color: stage.fg, padding: "1px 8px", borderRadius: 99, fontWeight: 700 }}>{items.length}</span>
                  {stage.key === "cola_canteo" && (
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>— tiempo muerto</span>
                  )}
                  {stage.key === "completado" && items.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8" }}>Se archivan en {ARCHIVE_AFTER_MIN} min</span>
                  )}
                </div>

                {items.length === 0 ? (
                  <div style={{ border: "1px dashed " + stage.border, borderRadius: 10, padding: "1.25rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                    Sin pedidos
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map(function(order) {
                      var stageTs  = order.timestamps && order.timestamps[order.stage];
                      var elapsed  = stageTs ? Date.now() - stageTs : null;
                      var ns       = getNext(order);
                      var nsObj    = ns ? getStageObj(ns) : null;
                      var payObj   = getPayObj(order.payment || "sin_pago");
                      var isOpen   = !!expanded[order.id];
                      var isEdit   = editing === order.id;

                      return (
                        <div key={order.id} style={{ background: "#fff", border: "1.5px solid " + stage.border, borderRadius: 12, overflow: "hidden", position: "relative" }}>

                          {/* Puntito modificado */}
                          {order.modified && (
                            <div title={"Modificado " + (order.modifiedAt ? timeAgo(order.modifiedAt) : "")} style={{
                              position: "absolute", top: 8, right: 8, width: 10, height: 10,
                              borderRadius: "50%", background: "#F97316", border: "2px solid #fff", zIndex: 5,
                            }} />
                          )}

                          {/* Cabecera clickeable */}
                          <div
                            onClick={function() { if (!isEdit) toggleExpand(order.id); }}
                            style={{ padding: "0.875rem 1rem", cursor: "pointer", userSelect: "none" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap", paddingRight: order.modified ? 18 : 0 }}>
                              <span style={{ fontWeight: 700, fontSize: 15, color: "#1E293B" }}>{order.numero}</span>
                              <span style={{ fontSize: 15, color: "#1E293B", fontWeight: 500 }}>{order.cliente}</span>
                              {order.cantidadPlacas > 0 && (
                                <span style={{ fontSize: 12, fontWeight: 800, background: "#EFF6FF", color: "#1D4ED8", padding: "2px 10px", borderRadius: 99, border: "1.5px solid #BFDBFE" }}>
                                  {order.cantidadPlacas} placa{order.cantidadPlacas !== 1 ? "s" : ""}
                                </span>
                              )}
                              <span style={{ fontSize: 11, fontWeight: 700, background: order.canto ? "#EDE9FE" : "#F1F5F9", color: order.canto ? "#4C1D95" : "#64748B", padding: "2px 8px", borderRadius: 99 }}>
                                {order.canto ? "Con canto" : "Sin canto"}
                              </span>
                              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8" }}>{order.hora} · {timeAgo(stageTs)}</span>
                            </div>

                            {order.observaciones && !isEdit && (
                              <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6, background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", borderLeft: "3px solid " + stage.border, whiteSpace: "pre-wrap", marginBottom: 4 }}>
                                {order.observaciones}
                              </div>
                            )}

                            {elapsed && elapsed > 0 && !isEdit && (
                              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>⏱ {fmt(elapsed)} en esta etapa</div>
                            )}

                            {/* Panel expandido */}
                            {isOpen && !isEdit && (
                              <div style={{ marginTop: 10, padding: "10px 12px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: mode === "gestion" ? 10 : 0 }}>
                                  <span style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Estado de pago:</span>
                                  <span style={{ fontSize: 12, fontWeight: 700, background: payObj.bg, color: payObj.fg, padding: "3px 10px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                    <Dot color={payObj.dot} size={7} />{payObj.label}
                                  </span>
                                </div>

                                {mode === "gestion" && (
                                  <div>
                                    <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6 }}>Cambiar estado de pago:</div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      {PAYMENT_OPTS.map(function(p) {
                                        var active = (order.payment || "sin_pago") === p.key;
                                        return (
                                          <button key={p.key}
                                            onClick={function(e) { e.stopPropagation(); updatePayment(order.id, p.key); }}
                                            style={{
                                              fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 99, cursor: "pointer",
                                              background: active ? p.bg : "#F1F5F9",
                                              color: active ? p.fg : "#64748B",
                                              border: "1.5px solid " + (active ? p.dot : "#E2E8F0"),
                                              display: "inline-flex", alignItems: "center", gap: 5,
                                            }}>
                                            <Dot color={p.dot} size={7} />{p.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {order.modified && (
                                  <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8", display: "flex", alignItems: "center", gap: 5 }}>
                                    <Dot color="#F97316" size={7} />
                                    Modificado {order.modifiedAt ? timeAgo(order.modifiedAt) : ""}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Formulario edición */}
                          {isEdit && (
                            <div style={{ padding: "0 1rem 1rem" }} onClick={function(e) { e.stopPropagation(); }}>
                              <div style={{ background: "#FFF7ED", border: "1.5px solid #F97316", borderRadius: 10, padding: "0.875rem" }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#7C2D12", marginBottom: 10 }}>✏️ Editando pedido</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  <input placeholder="Cliente *" value={editForm.cliente}
                                    onChange={function(e) { setEditForm(Object.assign({}, editForm, { cliente: e.target.value })); }}
                                    style={inp}
                                  />
                                  <textarea placeholder="Observaciones..." value={editForm.observaciones}
                                    onChange={function(e) { setEditForm(Object.assign({}, editForm, { observaciones: e.target.value })); }}
                                    rows={3}
                                    style={Object.assign({}, inp, { resize: "vertical", lineHeight: 1.5 })}
                                  />
                                  <label style={{
                                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none",
                                    padding: "8px 10px", borderRadius: 8,
                                    border: "1.5px solid " + (editForm.canto ? "#7C3AED" : "#E2E8F0"),
                                    background: editForm.canto ? "#EDE9FE" : "#F8FAFC",
                                  }}>
                                    <input type="checkbox" checked={editForm.canto}
                                      onChange={function(e) { setEditForm(Object.assign({}, editForm, { canto: e.target.checked })); }}
                                      style={{ width: 16, height: 16, accentColor: "#7C3AED", cursor: "pointer" }}
                                    />
                                    <span style={{ fontSize: 13, fontWeight: 600, color: editForm.canto ? "#4C1D95" : "#64748B" }}>
                                      {editForm.canto ? "✓ Lleva canto" : "Sin canto"}
                                    </span>
                                  </label>
                                </div>
                                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                  <button onClick={function() { saveEdit(order.id); }}
                                    style={{ flex: 1, background: "#F97316", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, padding: "8px", borderRadius: 8, cursor: "pointer" }}>
                                    Guardar cambios
                                  </button>
                                  <button onClick={function() { setEditing(null); }} style={{ fontSize: 13, padding: "8px 12px" }}>Cancelar</button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Barra de acciones */}
                          <div style={{ borderTop: "1px solid " + stage.bg, padding: "0.5rem 1rem", background: stage.bg, display: "flex", gap: 6, alignItems: "center" }}>
                            {mode === "gestion" && getPrev(order) && (
                              <button onClick={function() { goBack(order.id); }} style={{ fontSize: 12, padding: "4px 10px", color: "#64748B" }}>← Atrás</button>
                            )}

                            {ns ? (
                              <HoldButton onAction={function() { advance(order.id); }} color={nsObj && nsObj.dot} style={{ flex: 1 }}>
                                → {nsObj && nsObj.label}
                              </HoldButton>
                            ) : (
                              <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#14532D", textAlign: "center" }}>✓ Finalizado</div>
                            )}

                            <span style={{ fontSize: 11, fontWeight: 700, background: payObj.bg, color: payObj.fg, padding: "2px 8px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                              <Dot color={payObj.dot} size={6} />{payObj.label}
                            </span>

                            {mode === "gestion" && (
                              <div style={{ display: "flex", gap: 4 }}>
                                <button
                                  onClick={function(e) {
                                    e.stopPropagation();
                                    setEditForm({ cliente: order.cliente, observaciones: order.observaciones || "", canto: !!order.canto });
                                    setEditing(order.id);
                                    setExpanded(function(ex) { return Object.assign({}, ex, { [order.id]: false }); });
                                  }}
                                  title="Editar pedido"
                                  style={{ fontSize: 13, padding: "4px 8px", color: "#6366F1" }}>✏️</button>
                                {order.stage === "completado" && (
                                  <button onClick={function() { archiveNow(order.id); }} title="Archivar ahora" style={{ fontSize: 12, padding: "4px 8px", color: "#3B82F6" }}>📁</button>
                                )}
                                <button onClick={function() { deleteOrder(order.id); }} style={{ fontSize: 12, padding: "4px 8px", color: "#EF4444" }}>🗑</button>
                              </div>
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
        </div>
      )}

      {/* ══ ESTADÍSTICAS ═════════════════════════════════════════════════════════ */}
      {view === "resumen" && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: "1rem" }}>📊 Estadísticas de producción</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1.25rem" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Período</div>
              <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 8, padding: 3 }}>
                {[["hoy", "Hoy"], ["todo", "Todo"]].map(function(item) {
                  return (
                    <button key={item[0]} onClick={function() { setScope(item[0]); }} style={{
                      flex: 1, fontSize: 12, fontWeight: 600, padding: "6px 0", border: "none", borderRadius: 6,
                      background: scope === item[0] ? "#fff" : "transparent",
                      color: scope === item[0] ? "#1E293B" : "#64748B",
                      boxShadow: scope === item[0] ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    }}>{item[1]}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Tipo</div>
              <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 8, padding: 3 }}>
                {[["todos", "Todos"], ["canto", "Con canto"], ["sincanto", "Sin canto"]].map(function(item) {
                  return (
                    <button key={item[0]} onClick={function() { setFilter(item[0]); }} style={{
                      flex: 1, fontSize: 11, fontWeight: 600, padding: "6px 0", border: "none", borderRadius: 6,
                      background: filter === item[0] ? "#fff" : "transparent",
                      color: filter === item[0] ? "#1E293B" : "#64748B",
                      boxShadow: filter === item[0] ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    }}>{item[1]}</button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: "1.5rem" }}>
            {[
              { label: "Completados", value: byFilter.length,                        color: "#22C55E" },
              { label: "Con canto",   value: byFilter.filter(function(o) { return o.canto; }).length,  color: "#7C3AED" },
              { label: "Sin canto",   value: byFilter.filter(function(o) { return !o.canto; }).length, color: "#64748B" },
            ].map(function(k, i) {
              return (
                <div key={i} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "0.875rem", textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 5 }}>{k.label}</div>
                </div>
              );
            })}
          </div>

          {byFilter.length === 0 ? (
            <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "2rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              No hay pedidos completados para el período seleccionado.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>⏱ Tiempos por etapa</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.5rem" }}>
                <StatRow label="Preparación de material"             color="#6366F1" bg="#EEF2FF" values={tPrep} />
                <StatRow label="Corte"                               color="#EF4444" bg="#FEE2E2" values={tCorte} />
                {wCanto.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <StatRow label="Espera Cola Canteo (tiempo muerto)" color="#F97316" bg="#FFF7ED" values={tEsp} />
                    <StatRow label="Canteo"                             color="#F59E0B" bg="#FEF3C7" values={tCant} />
                  </div>
                )}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>📦 Tiempo total</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.5rem" }}>
                <StatRow label="Todos" color="#22C55E" bg="#DCFCE7" values={tTot} />
                {filter === "todos" && wCanto.length > 0 && woCanto.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <StatRow label="Solo con canto"  color="#7C3AED" bg="#EDE9FE" values={wCanto.map(function(o) { return stageTime(o, "activo", "completado"); })} />
                    <StatRow label="Solo sin canto"  color="#64748B" bg="#F1F5F9" values={woCanto.map(function(o) { return stageTime(o, "activo", "completado"); })} />
                  </div>
                )}
              </div>

              {todayAll.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Pedidos de hoy ({todayAll.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {todayAll.map(function(order) {
                      var total = stageTime(order, "activo", "completado");
                      return (
                        <div key={order.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "0.75rem 1rem", display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>{order.numero}</span>
                              <span style={{ fontSize: 13, color: "#475569" }}>{order.cliente}</span>
                              <span style={{ fontSize: 10, background: order.canto ? "#EDE9FE" : "#F1F5F9", color: order.canto ? "#4C1D95" : "#64748B", padding: "1px 6px", borderRadius: 99, fontWeight: 700 }}>
                                {order.canto ? "Con canto" : "Sin canto"}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#94A3B8", flexWrap: "wrap" }}>
                              {stageTime(order, "preparacion", "corte") && <span>Prep: {fmt(stageTime(order, "preparacion", "corte"))}</span>}
                              {stageTime(order, "corte", order.canto ? "cola_canteo" : "completado") && <span>Corte: {fmt(stageTime(order, "corte", order.canto ? "cola_canteo" : "completado"))}</span>}
                              {order.canto && stageTime(order, "cola_canteo", "canteo") && <span>Espera: {fmt(stageTime(order, "cola_canteo", "canteo"))}</span>}
                              {order.canto && stageTime(order, "canteo", "completado") && <span>Canteo: {fmt(stageTime(order, "canteo", "completado"))}</span>}
                            </div>
                          </div>
                          {total && <div style={{ fontSize: 13, color: "#22C55E", fontWeight: 800, flexShrink: 0 }}>{fmt(total)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ HISTORIAL ════════════════════════════════════════════════════════════ */}
      {view === "historial" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>🗂 Historial de pedidos</div>
            {mode === "gestion" && history.items.length > 0 && (
              <button onClick={clearHist} style={{ fontSize: 12, padding: "5px 12px", color: "#EF4444" }}>🗑 Borrar todo</button>
            )}
          </div>

          {history.items.length === 0 ? (
            <div style={{ border: "1px dashed #CBD5E1", borderRadius: 10, padding: "2.5rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🗂</div>
              Los pedidos completados aparecen acá después de {ARCHIVE_AFTER_MIN} minutos.
            </div>
          ) : (
            <div>
              {(function() {
                var todayH = history.items.filter(function(o) { return isToday(o.timestamps && o.timestamps.activo); });
                var oldH   = history.items.filter(function(o) { return !isToday(o.timestamps && o.timestamps.activo); });
                return (
                  <div>
                    {todayH.length > 0 && (
                      <div style={{ marginBottom: "1.5rem" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          Hoy ({todayH.length})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {todayH.map(function(o) { return <HistCard key={o.id} order={o} />; })}
                        </div>
                      </div>
                    )}
                    {oldH.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          Anteriores ({oldH.length})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {oldH.map(function(o) { return <HistCard key={o.id} order={o} />; })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistCard({ order }) {
  var total  = order.timestamps && order.timestamps.completado && order.timestamps.activo ? order.timestamps.completado - order.timestamps.activo : null;
  var fecha  = order.timestamps && order.timestamps.completado
    ? new Date(order.timestamps.completado).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : order.hora;
  var payObj = getPayObj(order.payment || "sin_pago");

  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "0.75rem 1rem", position: "relative" }}>
      {order.modified && (
        <div style={{ position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: "50%", background: "#F97316", border: "2px solid #fff" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap", paddingRight: order.modified ? 16 : 0 }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94A3B8" }}>{order.numero}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#1E293B" }}>{order.cliente}</span>
        <span style={{ fontSize: 10, background: order.canto ? "#EDE9FE" : "#F1F5F9", color: order.canto ? "#4C1D95" : "#64748B", padding: "1px 6px", borderRadius: 99, fontWeight: 700 }}>
          {order.canto ? "Con canto" : "Sin canto"}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, background: payObj.bg, color: payObj.fg, padding: "1px 7px", borderRadius: 99 }}>{payObj.label}</span>
        <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: "auto" }}>{fecha}</span>
        {total && <span style={{ fontSize: 11, background: "#DCFCE7", color: "#14532D", padding: "1px 7px", borderRadius: 99, fontWeight: 700 }}>{fmt(total)} total</span>}
      </div>
      {order.observaciones && (
        <div style={{ fontSize: 12, color: "#64748B", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{order.observaciones}</div>
      )}
    </div>
  );
}
