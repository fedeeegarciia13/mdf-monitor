import { useState, useEffect, useCallback, useRef } from "react";

const MONITOR_KEY  = "mdf_monitor_v7";
const CATALOG_KEY  = "mdf_catalog_v1";
const PIN = "1234";

const STAGES = [
  { key: "activo",     label: "Pedidos activos", dot: "#64748B", bg: "#F1F5F9", fg: "#1E293B", border: "#CBD5E1" },
  { key: "corte",      label: "Corte",           dot: "#EF4444", bg: "#FEE2E2", fg: "#7F1D1D", border: "#EF4444" },
  { key: "canteo",     label: "Canteo",          dot: "#F59E0B", bg: "#FEF3C7", fg: "#78350F", border: "#F59E0B" },
  { key: "completado", label: "Completados",     dot: "#22C55E", bg: "#DCFCE7", fg: "#14532D", border: "#22C55E" },
];
const NEXT_LABEL = { activo: "Enviar a Corte", corte: "Enviar a Canteo", canteo: "Marcar Completo" };
const NEXT_COLOR = { activo: "#EF4444", corte: "#F59E0B", canteo: "#22C55E" };

const EMPTY_ORDERS  = { orders: [], nextId: 1 };
const EMPTY_CATALOG = { items: [], nextCId: 1 };
const EMPTY_ENTRY   = { codigo: "", nombre: "", material: "", espesor: "", color: "", notas: "" };
const TABS = [
  { key: "cargar",   label: "➕  Cargar pedido" },
  { key: "catalogo", label: "📦  Catálogo" },
];

// ── Storage helpers usando localStorage ────────────────────────────────────
function lsGet(key) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function Dot({ color, size = 9 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, flexShrink:0 }} />;
}

export default function App() {
  const [orders, setOrders]         = useState(null);
  const [catalog, setCatalog]       = useState(null);
  const [mode, setMode]             = useState("operario");
  const [gTab, setGTab]             = useState("cargar");
  const [toast, setToast]           = useState(null);
  const [confirmPin, setConfirmPin] = useState(false);
  const [pinInput, setPinInput]     = useState("");

  // Carga rápida
  const [cliente, setCliente]       = useState("");
  const [codeInput, setCodeInput]   = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [cantidad, setCantidad]     = useState("1");
  const [cart, setCart]             = useState([]);
  const codeRef                     = useRef();

  // Catálogo – formulario
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editId, setEditId]               = useState(null);
  const [entryForm, setEntryForm]         = useState(EMPTY_ENTRY);
  const [catalogSearch, setCatalogSearch] = useState("");

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  // ── Storage ───────────────────────────────────────────────────────────────
  const loadOrders = useCallback(() => {
    const data = lsGet(MONITOR_KEY);
    setOrders(data || EMPTY_ORDERS);
  }, []);

  const loadCatalog = useCallback(() => {
    const data = lsGet(CATALOG_KEY);
    setCatalog(data || EMPTY_CATALOG);
  }, []);

  const saveOrders = useCallback((next) => {
    setOrders(next);
    if (!lsSet(MONITOR_KEY, next)) showToast("Error al guardar pedidos", "err");
  }, []);

  const saveCatalog = useCallback((next) => {
    setCatalog(next);
    if (!lsSet(CATALOG_KEY, next)) showToast("Error al guardar catálogo", "err");
  }, []);

  useEffect(() => {
    loadOrders();
    loadCatalog();
    // Polling para que si se abre en otra pestaña/dispositivo se sincronice
    const id = setInterval(loadOrders, 5000);
    return () => clearInterval(id);
  }, [loadOrders, loadCatalog]);

  // ── Autocompletado de código ──────────────────────────────────────────────
  const handleCodeChange = (val) => {
    setCodeInput(val);
    setSelectedItem(null);
    if (!val.trim() || !catalog) { setSuggestions([]); return; }
    const q = val.trim().toLowerCase();
    const matches = catalog.items.filter(c =>
      c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q)
    ).slice(0, 6);
    setSuggestions(matches);
  };

  const selectSuggestion = (item) => {
    setCodeInput(item.codigo);
    setSelectedItem(item);
    setSuggestions([]);
    setCantidad("1");
    setTimeout(() => document.getElementById("cant-input")?.focus(), 50);
  };

  const addToCart = () => {
    if (!selectedItem) {
      showToast("Seleccioná un artículo del catálogo", "err"); return;
    }
    const qty = Math.max(1, parseInt(cantidad) || 1);
    setCart(prev => [...prev, { ...selectedItem, cantidad: String(qty), cartId: Date.now() }]);
    setCodeInput("");
    setSelectedItem(null);
    setCantidad("1");
    setSuggestions([]);
    codeRef.current?.focus();
  };

  const removeFromCart = (cartId) => setCart(prev => prev.filter(i => i.cartId !== cartId));

  const confirmCart = () => {
    if (cart.length === 0) { showToast("Agregá al menos un artículo", "err"); return; }
    let id = orders.nextId;
    const hora = new Date().toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" });
    const newOrders = cart.map(p => ({
      id: id++,
      numero: `PED-${String(id - 1).padStart(4, "0")}`,
      cliente:  cliente.trim() || "Sin cliente",
      articulo: p.codigo,
      nombre:   p.nombre,
      material: p.material,
      espesor:  p.espesor,
      color:    p.color,
      cantidad: p.cantidad,
      notas:    p.notas || "",
      stage: "activo", hora,
    }));
    saveOrders({ orders: [...orders.orders, ...newOrders], nextId: id });
    setCart([]); setCliente(""); setCodeInput(""); setSelectedItem(null); setCantidad("1");
    showToast(`${newOrders.length} artículo${newOrders.length !== 1 ? "s" : ""} cargado${newOrders.length !== 1 ? "s" : ""}`);
  };

  // ── Pedidos ───────────────────────────────────────────────────────────────
  const advance = (id) => {
    const seq = ["activo", "corte", "canteo", "completado"];
    saveOrders({ ...orders, orders: orders.orders.map(o => {
      if (o.id !== id) return o;
      const i = seq.indexOf(o.stage);
      return i < seq.length - 1 ? { ...o, stage: seq[i + 1] } : o;
    })});
  };
  const goBack = (id) => {
    const seq = ["activo", "corte", "canteo", "completado"];
    saveOrders({ ...orders, orders: orders.orders.map(o => {
      if (o.id !== id) return o;
      const i = seq.indexOf(o.stage);
      return i > 0 ? { ...o, stage: seq[i - 1] } : o;
    })});
  };
  const deleteOrder = (id) => { saveOrders({ ...orders, orders: orders.orders.filter(o => o.id !== id) }); showToast("Eliminado"); };

  // ── Catálogo ──────────────────────────────────────────────────────────────
  const saveEntry = () => {
    if (!entryForm.codigo.trim() || !entryForm.material.trim()) { showToast("Código y material son obligatorios", "err"); return; }
    const items = catalog.items;
    if (editId !== null) {
      saveCatalog({ ...catalog, items: items.map(i => i.id === editId ? { ...i, ...entryForm } : i) });
      showToast("Artículo actualizado");
    } else {
      if (items.find(i => i.codigo.toLowerCase() === entryForm.codigo.toLowerCase())) { showToast("Ese código ya existe", "err"); return; }
      saveCatalog({ items: [...items, { id: catalog.nextCId, ...entryForm }], nextCId: catalog.nextCId + 1 });
      showToast("Artículo agregado");
    }
    setEntryForm(EMPTY_ENTRY); setShowEntryForm(false); setEditId(null);
  };
  const editEntry = (item) => { setEntryForm({ codigo: item.codigo, nombre: item.nombre, material: item.material, espesor: item.espesor, color: item.color, notas: item.notas || "" }); setEditId(item.id); setShowEntryForm(true); };
  const deleteEntry = (id) => { saveCatalog({ ...catalog, items: catalog.items.filter(i => i.id !== id) }); showToast("Artículo eliminado"); };

  const tryGestion = () => { setConfirmPin(true); setPinInput(""); };
  const checkPin = () => {
    if (pinInput === PIN) { setMode("gestion"); setConfirmPin(false); }
    else { showToast("PIN incorrecto", "err"); setPinInput(""); }
  };

  if (!orders || !catalog) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8", fontSize: 14 }}>⏳ Cargando...</div>
  );

  const byStage = key => orders.orders.filter(o => o.stage === key);
  const filteredCatalog = catalog.items.filter(i =>
    i.codigo.toLowerCase().includes(catalogSearch.toLowerCase()) ||
    i.nombre.toLowerCase().includes(catalogSearch.toLowerCase()) ||
    i.material.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  const inp = { fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", width: "100%", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.04em" };

  return (
    <div style={{ fontFamily: "system-ui", padding: "0.875rem 0" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "sticky", top: 0, zIndex: 20, marginBottom: 12,
          background: toast.type === "err" ? "#FEE2E2" : toast.type === "warn" ? "#FEF3C7" : "#DCFCE7",
          color: toast.type === "err" ? "#7F1D1D" : toast.type === "warn" ? "#78350F" : "#14532D",
          padding: "0.5rem 1rem", borderRadius: 10, fontSize: 13, fontWeight: 500,
        }}>{toast.msg}</div>
      )}

      {/* PIN */}
      {confirmPin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Acceso a Gestión</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Ingresá el PIN para continuar</div>
            <input type="password" placeholder="PIN" value={pinInput}
              onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === "Enter" && checkPin()}
              style={{ ...inp, fontSize: 20, textAlign: "center", letterSpacing: 8, marginBottom: 12 }} autoFocus />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={checkPin} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 14, padding: "8px", borderRadius: 8 }}>Entrar</button>
              <button onClick={() => setConfirmPin(false)} style={{ fontSize: 14, padding: "8px 14px" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>📋 Monitor de producción</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Actualización en tiempo real · cada 5 seg</div>
        </div>
        {mode === "operario" ? (
          <button onClick={tryGestion} style={{ fontSize: 12, padding: "5px 12px" }}>⚙ Gestión</button>
        ) : (
          <button onClick={() => { setMode("operario"); setCart([]); }} style={{ fontSize: 12, padding: "5px 12px", background: "#FEF3C7", color: "#78350F", border: "1px solid #F59E0B" }}>
            ← Modo operario
          </button>
        )}
      </div>

      {/* Contadores */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: "1.25rem" }}>
        {STAGES.map(s => (
          <div key={s.key} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 12, padding: "0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.fg, lineHeight: 1 }}>{byStage(s.key).length}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: s.fg, marginTop: 4, opacity: 0.85 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ══ GESTIÓN ══════════════════════════════════════════════════════════════ */}
      {mode === "gestion" && (
        <div style={{ marginBottom: "1.5rem" }}>

          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: "1rem", background: "#F1F5F9", borderRadius: 10, padding: 3 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setGTab(t.key)} style={{
                flex: 1, fontSize: 12, fontWeight: 600, padding: "7px 10px",
                background: gTab === t.key ? "#fff" : "transparent",
                color: gTab === t.key ? "#1E293B" : "#64748B",
                border: "none", borderRadius: 8,
                boxShadow: gTab === t.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              }}>{t.label}</button>
            ))}
          </div>

          {/* ── CARGAR PEDIDO ── */}
          {gTab === "cargar" && (
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem" }}>

              {/* Cliente */}
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Cliente</label>
                <input placeholder="Nombre del cliente (opcional)" value={cliente}
                  onChange={e => setCliente(e.target.value)} style={inp} />
              </div>

              {/* Buscador de código */}
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Código de artículo</label>
                <div style={{ position: "relative" }}>
                  <input
                    ref={codeRef}
                    placeholder="Escribí el código o el nombre..."
                    value={codeInput}
                    onChange={e => handleCodeChange(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && suggestions.length === 1) selectSuggestion(suggestions[0]); }}
                    style={{ ...inp, paddingRight: 36 }}
                    autoComplete="off"
                  />
                  {codeInput && (
                    <button onClick={() => { setCodeInput(""); setSelectedItem(null); setSuggestions([]); codeRef.current?.focus(); }}
                      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 16, color: "#94A3B8", cursor: "pointer", padding: 0 }}>
                      ✕
                    </button>
                  )}

                  {/* Dropdown sugerencias */}
                  {suggestions.length > 0 && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1.5px solid #CBD5E1", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 30, overflow: "hidden" }}>
                      {suggestions.map(item => (
                        <div key={item.id}
                          onClick={() => selectSuggestion(item)}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #F1F5F9", transition: "background 0.1s" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94A3B8", flexShrink: 0 }}>{item.codigo}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{item.nombre || item.material}</span>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                            <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 99 }}>{item.material}</span>
                            {item.espesor && <span style={{ fontSize: 11, color: "#64748B" }}>e:{item.espesor}mm</span>}
                            {item.color && <span style={{ fontSize: 11, color: "#64748B" }}>· {item.color}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sin resultados */}
                  {codeInput.length > 1 && suggestions.length === 0 && !selectedItem && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1.5px solid #FEE2E2", borderRadius: 10, padding: "10px 14px", zIndex: 30 }}>
                      <span style={{ fontSize: 13, color: "#EF4444" }}>Código no encontrado en el catálogo</span>
                      <button onClick={() => { setGTab("catalogo"); setEntryForm({ ...EMPTY_ENTRY, codigo: codeInput }); setShowEntryForm(true); setEditId(null); }}
                        style={{ marginLeft: 10, fontSize: 12, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                        + Agregar al catálogo
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Artículo seleccionado + cantidad */}
              {selectedItem && (
                <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 3 }}>{selectedItem.nombre || selectedItem.material}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ background: "#DBEAFE", color: "#1D4ED8", fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 99 }}>{selectedItem.material}</span>
                        {selectedItem.espesor && <span style={{ fontSize: 12, color: "#1D4ED8" }}>e:{selectedItem.espesor}mm</span>}
                        {selectedItem.color && <span style={{ fontSize: 12, color: "#1D4ED8" }}>· {selectedItem.color}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <label style={{ fontSize: 12, color: "#1D4ED8", fontWeight: 600 }}>Cantidad</label>
                      <input id="cant-input" type="number" min="1" value={cantidad}
                        onChange={e => setCantidad(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addToCart()}
                        style={{ ...inp, width: 64, textAlign: "center", padding: "6px 8px" }} />
                    </div>
                  </div>
                  <button onClick={addToCart}
                    style={{ marginTop: 10, width: "100%", background: "#1D4ED8", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, padding: "8px", borderRadius: 8, cursor: "pointer" }}>
                    + Agregar a la lista
                  </button>
                </div>
              )}

              {/* Carrito / lista acumulada */}
              {cart.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ ...lbl, marginBottom: 8 }}>Lista del pedido ({cart.length} artículo{cart.length !== 1 ? "s" : ""})</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                    {cart.map(item => (
                      <div key={item.cartId} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: "#1E293B" }}>{item.nombre || item.material}</span>
                          <span style={{ fontSize: 12, color: "#64748B", marginLeft: 8 }}>
                            {item.material}{item.espesor ? ` · e:${item.espesor}mm` : ""}{item.color ? ` · ${item.color}` : ""}
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", minWidth: 32, textAlign: "right" }}>×{item.cantidad}</span>
                        <button onClick={() => removeFromCart(item.cartId)} style={{ fontSize: 13, padding: "2px 6px", color: "#EF4444", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={confirmCart}
                    style={{ width: "100%", background: "#22C55E", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: "11px", borderRadius: 10, cursor: "pointer" }}>
                    ✓ Confirmar y cargar pedido
                  </button>
                </div>
              )}

              {cart.length === 0 && !selectedItem && catalog.items.length === 0 && (
                <div style={{ textAlign: "center", padding: "1rem", color: "#94A3B8", fontSize: 13 }}>
                  El catálogo está vacío. Agregá artículos en la pestaña <strong>Catálogo</strong> primero.
                </div>
              )}
            </div>
          )}

          {/* ── CATÁLOGO ── */}
          {gTab === "catalogo" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input placeholder="🔍 Buscar código, nombre o material..."
                  value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { setShowEntryForm(true); setEditId(null); setEntryForm(EMPTY_ENTRY); }}
                  style={{ fontSize: 13, padding: "7px 14px", background: "#1E293B", color: "#fff", border: "none", borderRadius: 8, whiteSpace: "nowrap", fontWeight: 500 }}>
                  + Agregar
                </button>
              </div>

              {showEntryForm && (
                <div style={{ background: "#F8FAFC", border: "1.5px solid #3B82F6", borderRadius: 12, padding: "1rem", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 12 }}>
                    {editId !== null ? "✏ Editar artículo" : "➕ Nuevo artículo"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={lbl}>Código *</label>
                      <input placeholder="ej: 180001518G068CE" value={entryForm.codigo}
                        onChange={e => setEntryForm({ ...entryForm, codigo: e.target.value })}
                        style={{ ...inp, fontFamily: "monospace" }} disabled={editId !== null} />
                    </div>
                    <div>
                      <label style={lbl}>Nombre comercial</label>
                      <input placeholder="ej: Melamínico Blanco 18mm" value={entryForm.nombre}
                        onChange={e => setEntryForm({ ...entryForm, nombre: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Material *</label>
                      <input placeholder="ej: Melamínico s/aglomerado" value={entryForm.material}
                        onChange={e => setEntryForm({ ...entryForm, material: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Espesor (mm)</label>
                      <input placeholder="ej: 18" value={entryForm.espesor} type="number"
                        onChange={e => setEntryForm({ ...entryForm, espesor: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Color / terminación</label>
                      <input placeholder="ej: Blanco, Natural, Roble" value={entryForm.color}
                        onChange={e => setEntryForm({ ...entryForm, color: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Notas</label>
                      <input placeholder="observaciones opcionales" value={entryForm.notas}
                        onChange={e => setEntryForm({ ...entryForm, notas: e.target.value })} style={inp} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveEntry} style={{ flex: 1, background: "#1E293B", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, padding: "9px", borderRadius: 8 }}>
                      {editId !== null ? "Guardar cambios" : "Agregar al catálogo"}
                    </button>
                    <button onClick={() => { setShowEntryForm(false); setEditId(null); setEntryForm(EMPTY_ENTRY); }} style={{ fontSize: 13, padding: "9px 14px" }}>Cancelar</button>
                  </div>
                </div>
              )}

              {catalog.items.length === 0 ? (
                <div style={{ border: "1px dashed #CBD5E1", borderRadius: 10, padding: "2rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
                  Catálogo vacío. Agregá el primer artículo.
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 13, padding: "1.5rem" }}>Sin resultados para "{catalogSearch}"</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {filteredCatalog.map(item => (
                    <div key={item.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "0.75rem", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1E293B" }}>{item.codigo}</span>
                          {item.nombre && <span style={{ fontSize: 13, color: "#475569" }}>{item.nombre}</span>}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                          <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 99 }}>{item.material}</span>
                          {item.espesor && <span style={{ fontSize: 12, color: "#64748B" }}>e:{item.espesor}mm</span>}
                          {item.color && <span style={{ fontSize: 12, color: "#64748B" }}>· {item.color}</span>}
                          {item.notas && <span style={{ fontSize: 11, color: "#94A3B8", fontStyle: "italic" }}>· {item.notas}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => editEntry(item)} style={{ fontSize: 12, padding: "4px 9px", color: "#3B82F6" }}>✏</button>
                        <button onClick={() => deleteEntry(item.id)} style={{ fontSize: 12, padding: "4px 9px", color: "#EF4444" }}>🗑</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", marginTop: 4 }}>
                    {catalog.items.length} artículo{catalog.items.length !== 1 ? "s" : ""} en el catálogo
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ 4 ETAPAS ══════════════════════════════════════════════════════════════ */}
      {STAGES.map(stage => {
        const items = byStage(stage.key);
        return (
          <div key={stage.key} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Dot color={stage.dot} size={10} />
              <span style={{ fontSize: 13, fontWeight: 600, color: stage.fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stage.label}</span>
              <span style={{ fontSize: 12, background: stage.bg, color: stage.fg, padding: "1px 8px", borderRadius: 99, fontWeight: 600 }}>{items.length}</span>
            </div>
            {items.length === 0 ? (
              <div style={{ border: `1px dashed ${stage.border}`, borderRadius: 10, padding: "1.25rem", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Sin pedidos</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map(order => (
                  <div key={order.id} style={{ background: "#fff", border: `1.5px solid ${stage.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "0.875rem 1rem" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: "#1E293B" }}>{order.numero}</span>
                        <span style={{ fontSize: 15, color: "#1E293B" }}>{order.cliente}</span>
                        <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: "auto" }}>{order.hora}</span>
                      </div>
                      {order.nombre && <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 3 }}>{order.nombre}</div>}
                      <div style={{ fontSize: 13, color: "#475569", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: 12, fontWeight: 600, padding: "1px 8px", borderRadius: 99 }}>{order.material}</span>
                        {order.espesor && <span>e: {order.espesor}mm</span>}
                        {order.color && order.color !== "Natural" && <span>· {order.color}</span>}
                        <span style={{ fontWeight: 600, color: "#1E293B" }}>×{order.cantidad}</span>
                        {order.notas && <span style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>· {order.notas}</span>}
                      </div>
                    </div>
                    <div style={{ borderTop: `1px solid ${stage.bg}`, padding: "0.5rem 1rem", background: stage.bg, display: "flex", gap: 6, alignItems: "center" }}>
                      {mode === "gestion" && order.stage !== "activo" && (
                        <button onClick={() => goBack(order.id)} style={{ fontSize: 12, padding: "4px 10px", color: "#64748B" }}>← Atrás</button>
                      )}
                      {order.stage !== "completado" ? (
                        <button onClick={() => advance(order.id)}
                          style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: "7px 12px", background: NEXT_COLOR[order.stage], color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                          {NEXT_LABEL[order.stage]}
                        </button>
                      ) : (
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#14532D", textAlign: "center" }}>✓ Finalizado</div>
                      )}
                      {mode === "gestion" && (
                        <button onClick={() => deleteOrder(order.id)} style={{ fontSize: 12, padding: "4px 8px", color: "#EF4444" }}>🗑</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
