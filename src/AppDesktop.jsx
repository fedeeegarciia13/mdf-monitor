import { useState, useEffect, useCallback, useRef } from "react";

const ORDERS_KEY        = "mdf_orders_v8";
const HISTORY_KEY       = "mdf_history_v1";
const PIN               = "1234";
const ARCHIVE_AFTER_MIN = 1440;
const HOLD_MS           = 600;
const TICK_MS           = 20;

const STAGES = [
  { key:"activo",      label:"Activos",     dot:"#64748B", bg:"#F1F5F9", fg:"#1E293B", border:"#CBD5E1", header:"#E2E8F0" },
  { key:"preparacion", label:"Preparación", dot:"#6366F1", bg:"#EEF2FF", fg:"#312E81", border:"#6366F1", header:"#C7D2FE" },
  { key:"corte",       label:"Corte",       dot:"#EF4444", bg:"#FEE2E2", fg:"#7F1D1D", border:"#EF4444", header:"#FECACA" },
  { key:"cola_canteo", label:"Cola Canteo", dot:"#F97316", bg:"#FFF7ED", fg:"#7C2D12", border:"#F97316", header:"#FED7AA" },
  { key:"canteo",      label:"Canteo",      dot:"#F59E0B", bg:"#FEF3C7", fg:"#78350F", border:"#F59E0B", header:"#FDE68A" },
  { key:"completado",  label:"Completados", dot:"#22C55E", bg:"#DCFCE7", fg:"#14532D", border:"#22C55E", header:"#BBF7D0" },
];
const SEQ_CON = ["activo","preparacion","corte","cola_canteo","canteo","completado"];
const SEQ_SIN = ["activo","preparacion","corte","completado"];

const PAYMENT_OPTS = [
  { key:"sin_pago", label:"Sin pago",     dot:"#EF4444", bg:"#FEE2E2", fg:"#7F1D1D" },
  { key:"parcial",  label:"Parcial",      dot:"#F59E0B", bg:"#FEF3C7", fg:"#78350F" },
  { key:"pagado",   label:"Pagado",       dot:"#22C55E", bg:"#DCFCE7", fg:"#14532D" },
];

const SUPABASE_URL = "https://ykygszjqqnkgqjowbanj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlreWdzempxcW5rZ3Fqb3diYW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMDMsImV4cCI6MjA5NTk4NzEwM30.K24YPH1WeN7eUGpG2OJqfxYCYfNFm5DOxwWiictT_3Y";

async function sbGet(key) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/mdf_pedidos?key=eq."+key+"&select=value",{
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
  });
  const data = await res.json();
  if(data&&data.length>0) return JSON.parse(data[0].value);
  return null;
}
async function sbSet(key,value) {
  await fetch(SUPABASE_URL+"/rest/v1/mdf_pedidos",{
    method:"POST",
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
    body:JSON.stringify({key:key,value:JSON.stringify(value),updated_at:new Date().toISOString()})
  });
}

const EMPTY_ORDERS  = { orders:[], nextId:1 };
const EMPTY_HISTORY = { items:[] };

function getSeq(o)     { return o.canto ? SEQ_CON : SEQ_SIN; }
function getNext(o)    { var s=getSeq(o),i=s.indexOf(o.stage); return i<s.length-1?s[i+1]:null; }
function getPrev(o)    { var s=getSeq(o),i=s.indexOf(o.stage); return i>0?s[i-1]:null; }
function getStageObj(k){ return STAGES.find(function(s){return s.key===k;})||STAGES[0]; }
function getPayObj(k)  { return PAYMENT_OPTS.find(function(p){return p.key===k;})||PAYMENT_OPTS[0]; }

function fmt(ms) {
  if (!ms||ms<=0) return "—";
  var t=Math.floor(ms/60000),d=Math.floor(t/1440),h=Math.floor((t%1440)/60),m=t%60;
  if (d>0) return (d+"d "+(h>0?h+"h ":"")+(m>0?m+"min":"")).trim();
  if (h>0) return h+"h"+(m>0?" "+m+"min":"");
  return m+" min";
}

function timeAgo(ts) {
  if (!ts) return "";
  var m=Math.floor((Date.now()-ts)/60000);
  if (m<1) return "recién"; if (m<60) return m+"min";
  var h=Math.floor(m/60); if (h<24) return h+"h";
  return Math.floor(h/24)+"d";
}

function isToday(ts) {
  if (!ts) return false;
  var a=new Date(ts),b=new Date();
  return a.getDate()===b.getDate()&&a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear();
}

function Dot(p) {
  return <span style={{display:"inline-block",width:p.size||8,height:p.size||8,borderRadius:"50%",background:p.color,flexShrink:0}}/>;
}

function HoldButton({ onAction, children, color, style }) {
  var [progress,setProgress]=useState(0),[holding,setHolding]=useState(false);
  var timer=useRef(null),elapsed=useRef(0);
  function start(e){ e.preventDefault(); elapsed.current=0; setProgress(0); setHolding(true);
    timer.current=setInterval(function(){
      elapsed.current+=TICK_MS;
      var pct=Math.min((elapsed.current/HOLD_MS)*100,100); setProgress(pct);
      if(elapsed.current>=HOLD_MS){clearInterval(timer.current);setHolding(false);setProgress(0);onAction();}
    },TICK_MS);
  }
  function cancel(){ clearInterval(timer.current); setHolding(false); setProgress(0); elapsed.current=0; }
  return (
    <button onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel}
      onContextMenu={function(e){e.preventDefault();}}
      style={Object.assign({position:"relative",overflow:"hidden",background:color||"#22C55E",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:700,padding:"5px 10px",cursor:"pointer",userSelect:"none",touchAction:"none",whiteSpace:"nowrap"},style||{})}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:progress+"%",background:"rgba(255,255,255,0.35)",pointerEvents:"none"}}/>
      <span style={{position:"relative",zIndex:1}}>
        {holding?"Mantené…":children}
      </span>
    </button>
  );
}

export default function AppDesktop() {
  var [orders,  setOrders]  = useState(null);
  var [history, setHistory] = useState(null);
  var [mode,    setMode]    = useState("operario");
  var [view,    setView]    = useState("monitor");
  var [toast,   setToast]   = useState(null);
  var [pin,     setPin]     = useState(false);
  var [pinVal,  setPinVal]  = useState("");
  var [showForm,setShowForm]= useState(false);
  var [form,    setForm]    = useState({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
  var [editing, setEditing] = useState(null);
  var [editForm,setEditForm]= useState({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
  var [tick,    setTick]    = useState(Date.now());
  var lastWrite = useRef(0);

  function toast_(msg,type){ setToast({msg:msg,type:type||"ok"}); setTimeout(function(){setToast(null);},2800); }

  useEffect(function(){ var id=setInterval(function(){setTick(Date.now());},30000); return function(){clearInterval(id);}; },[]);

  var loadOrders = useCallback(async function(){
    if (Date.now()-lastWrite.current<8000) return;
    try {
      var r=await sbGet(ORDERS_KEY);
      if(r&&Array.isArray(r.orders)) setOrders(r); else setOrders(function(prev){return prev||EMPTY_ORDERS;});
    } catch(e){ setOrders(function(prev){return prev||EMPTY_ORDERS;}); }
  },[]);

  var loadHistory = useCallback(async function(){
    try {
      var r=await sbGet(HISTORY_KEY);
      if(r&&Array.isArray(r.items)) setHistory(r); else setHistory(function(prev){return prev||EMPTY_HISTORY;});
    } catch(e){ setHistory(function(prev){return prev||EMPTY_HISTORY;}); }
  },[]);

  var saveOrders = useCallback(async function(next){
    lastWrite.current=Date.now(); setOrders(next);
    try { await sbSet(ORDERS_KEY,next); }
    catch(e){ toast_("Error al guardar","err"); }
  },[]);

  var saveHistory = useCallback(async function(next){
    setHistory(next);
    try { await sbSet(HISTORY_KEY,next); }
    catch(e){ toast_("Error al guardar historial","err"); }
  },[]);

  useEffect(function(){
    loadOrders(); loadHistory();
    var id=setInterval(function(){loadOrders();loadHistory();},5000);
    return function(){clearInterval(id);};
  },[loadOrders,loadHistory]);

  useEffect(function(){
    if (!orders||!history) return;
    var cutoff=Date.now()-ARCHIVE_AFTER_MIN*60*1000;
    var toArchive=orders.orders.filter(function(o){
      return o.stage==="completado"&&o.timestamps&&o.timestamps.completado&&o.timestamps.completado<cutoff;
    });
    if (!toArchive.length) return;
    var ids=toArchive.map(function(o){return o.id;});
    saveOrders(Object.assign({},orders,{orders:orders.orders.filter(function(o){return ids.indexOf(o.id)===-1;})}));
    saveHistory({items:toArchive.concat(history.items)});
  },[tick]); // eslint-disable-line

  function addOrder(){
    if (!form.cliente.trim()){ toast_("Ingresá el nombre del cliente","err"); return; }
    var ts=Date.now(), id=orders.nextId;
    var o={
      id:id, numero:"PED-"+String(id).padStart(4,"0"),
      cliente:form.cliente.trim(), observaciones:form.observaciones.trim(),
      canto:form.canto, cantidadPlacas:parseInt(form.cantidadPlacas)||0,
      stage:"activo", payment:"sin_pago", modified:false,
      fechaIngreso:ts,
      hora:new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}),
      timestamps:{activo:ts},
    };
    saveOrders({orders:orders.orders.concat([o]),nextId:id+1});
    setForm({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
    setShowForm(false);
    toast_(o.numero+" cargado");
  }

  function saveEdit(id){
    if (!editForm.cliente.trim()){ toast_("El cliente no puede estar vacío","err"); return; }
    saveOrders(Object.assign({},orders,{orders:orders.orders.map(function(o){
      if (o.id!==id) return o;
      return Object.assign({},o,{cliente:editForm.cliente.trim(),observaciones:editForm.observaciones.trim(),canto:editForm.canto,cantidadPlacas:parseInt(editForm.cantidadPlacas)||0,modified:true,modifiedAt:Date.now()});
    })}));
    setEditing(null); toast_("Pedido actualizado");
  }

  function updatePayment(id,pay){
    saveOrders(Object.assign({},orders,{orders:orders.orders.map(function(o){return o.id===id?Object.assign({},o,{payment:pay}):o;})}));
  }

  function advance(id){
    var ts=Date.now();
    saveOrders(Object.assign({},orders,{orders:orders.orders.map(function(o){
      if (o.id!==id) return o;
      var next=getNext(o); if(!next) return o;
      var t=Object.assign({},o.timestamps); t[next]=ts;
      return Object.assign({},o,{stage:next,timestamps:t});
    })}));
  }

  function goBack(id){
    saveOrders(Object.assign({},orders,{orders:orders.orders.map(function(o){
      if (o.id!==id) return o;
      var prev=getPrev(o); if(!prev) return o;
      var t=Object.assign({},o.timestamps); delete t[o.stage];
      return Object.assign({},o,{stage:prev,timestamps:t});
    })}));
  }

  function deleteOrder(id){ saveOrders(Object.assign({},orders,{orders:orders.orders.filter(function(o){return o.id!==id;})})); toast_("Eliminado"); }

  function archiveNow(id){
    var order=orders.orders.find(function(o){return o.id===id;}); if(!order) return;
    saveOrders(Object.assign({},orders,{orders:orders.orders.filter(function(o){return o.id!==id;})}));
    saveHistory({items:[order].concat(history.items)}); toast_("Movido al historial");
  }

  function clearHist(){ if(!window.confirm("¿Borrar todo el historial?")) return; saveHistory(EMPTY_HISTORY); toast_("Historial borrado"); }
  function openPin(){ setPin(true); setPinVal(""); }
  function checkPin(){ if(pinVal===PIN){setMode("gestion");setPin(false);} else{toast_("PIN incorrecto","err");setPinVal("");} }

  if (!orders||!history) return (
    <div style={{padding:"3rem",textAlign:"center",color:"#94A3B8",fontFamily:"system-ui"}}>⏳ Cargando...</div>
  );

  var totalPlacas = orders.orders.filter(function(o){return o.stage!=="completado";}).reduce(function(s,o){return s+(o.cantidadPlacas||0);},0);

  var inp={fontSize:13,padding:"7px 10px",borderRadius:7,border:"1px solid #CBD5E1",background:"#fff",width:"100%",boxSizing:"border-box"};

  return (
    <div style={{fontFamily:"system-ui,sans-serif",minHeight:"100vh",background:"#0F172A",color:"#F1F5F9",display:"flex",flexDirection:"column"}}>

      {/* Toast */}
      {toast&&(
        <div style={{position:"fixed",top:16,right:16,zIndex:100,background:toast.type==="err"?"#FEE2E2":"#DCFCE7",color:toast.type==="err"?"#7F1D1D":"#14532D",padding:"10px 18px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,0.3)"}}>
          {toast.msg}
        </div>
      )}

      {/* Modal PIN */}
      {pin&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1E293B",borderRadius:16,padding:"1.5rem",width:280,boxShadow:"0 8px 40px rgba(0,0,0,0.5)",border:"1px solid #334155"}}>
            <div style={{fontSize:15,fontWeight:700,color:"#F1F5F9",marginBottom:4}}>Acceso a Gestión</div>
            <div style={{fontSize:13,color:"#94A3B8",marginBottom:16}}>Ingresá el PIN para continuar</div>
            <input type="password" placeholder="PIN" value={pinVal} autoFocus
              onChange={function(e){setPinVal(e.target.value);}}
              onKeyDown={function(e){if(e.key==="Enter")checkPin();}}
              style={Object.assign({},inp,{fontSize:22,textAlign:"center",letterSpacing:10,marginBottom:12,background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569"})}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={checkPin} style={{flex:1,background:"#6366F1",color:"#fff",border:"none",fontSize:14,padding:"9px",borderRadius:8,cursor:"pointer",fontWeight:700}}>Entrar</button>
              <button onClick={function(){setPin(false);}} style={{fontSize:14,padding:"9px 14px",background:"#334155",color:"#94A3B8",border:"none",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edición */}
      {editing!==null&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1E293B",borderRadius:16,padding:"1.5rem",width:420,boxShadow:"0 8px 40px rgba(0,0,0,0.5)",border:"1px solid #334155"}}>
            <div style={{fontSize:15,fontWeight:700,color:"#F1F5F9",marginBottom:14}}>✏️ Editar pedido</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input placeholder="Cliente *" value={editForm.cliente} onChange={function(e){setEditForm(Object.assign({},editForm,{cliente:e.target.value}));}} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569"})} autoFocus/>
              <textarea placeholder="Observaciones..." value={editForm.observaciones} onChange={function(e){setEditForm(Object.assign({},editForm,{observaciones:e.target.value}));}} rows={3} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569",resize:"vertical",lineHeight:1.5})}/>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="number" min="1" placeholder="Nº placas" value={editForm.cantidadPlacas} onChange={function(e){setEditForm(Object.assign({},editForm,{cantidadPlacas:e.target.value}));}} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569",width:120,textAlign:"center"})}/>
                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",flex:1,padding:"8px 10px",borderRadius:8,border:"1.5px solid "+(editForm.canto?"#7C3AED":"#475569"),background:editForm.canto?"#2E1065":"#0F172A"}}>
                  <input type="checkbox" checked={editForm.canto} onChange={function(e){setEditForm(Object.assign({},editForm,{canto:e.target.checked}));}} style={{width:16,height:16,accentColor:"#7C3AED",cursor:"pointer"}}/>
                  <span style={{fontSize:13,fontWeight:600,color:editForm.canto?"#C4B5FD":"#94A3B8"}}>{editForm.canto?"✓ Lleva canto":"Sin canto"}</span>
                </label>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={function(){saveEdit(editing);}} style={{flex:1,background:"#6366F1",color:"#fff",border:"none",fontSize:13,fontWeight:700,padding:"9px",borderRadius:8,cursor:"pointer"}}>Guardar cambios</button>
              <button onClick={function(){setEditing(null);}} style={{fontSize:13,padding:"9px 14px",background:"#334155",color:"#94A3B8",border:"none",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOPBAR ── */}
      <div style={{background:"#1E293B",borderBottom:"1px solid #334155",padding:"0 1.5rem",height:52,display:"flex",alignItems:"center",gap:16,flexShrink:0}}>
        <div style={{fontSize:16,fontWeight:800,color:"#F1F5F9",letterSpacing:"-0.02em"}}>📋 Monitor MDF</div>
        <div style={{fontSize:11,color:"#64748B"}}>·</div>
        <div style={{fontSize:11,color:"#64748B"}}>Tiempo real · cada 5 seg</div>

        {/* KPIs rápidos */}
        <div style={{display:"flex",gap:8,marginLeft:8}}>
          {STAGES.map(function(s){
            var n=orders.orders.filter(function(o){return o.stage===s.key;}).length;
            return (
              <div key={s.key} style={{display:"flex",alignItems:"center",gap:5,background:"#0F172A",borderRadius:7,padding:"3px 10px",border:"1px solid #334155"}}>
                <Dot color={s.dot} size={7}/>
                <span style={{fontSize:12,fontWeight:700,color:"#F1F5F9"}}>{n}</span>
                <span style={{fontSize:10,color:"#64748B"}}>{s.label}</span>
              </div>
            );
          })}
        </div>

        {totalPlacas>0&&(
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#1D4ED8",borderRadius:7,padding:"3px 12px",marginLeft:4}}>
            <span style={{fontSize:12,fontWeight:800,color:"#fff"}}>{totalPlacas}</span>
            <span style={{fontSize:10,color:"#BFDBFE"}}>placas en proceso</span>
          </div>
        )}

        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          {/* Nav tabs */}
          {[["monitor","Monitor"],["historial","Historial"]].map(function(item){
            return <button key={item[0]} onClick={function(){setView(item[0]);}} style={{fontSize:12,fontWeight:600,padding:"5px 14px",background:view===item[0]?"#334155":"transparent",color:view===item[0]?"#F1F5F9":"#64748B",border:"none",borderRadius:7,cursor:"pointer"}}>{item[1]}</button>;
          })}
          <div style={{width:1,height:20,background:"#334155",margin:"0 4px"}}/>
          {mode==="operario"
            ?<button onClick={openPin} style={{fontSize:12,padding:"5px 14px",background:"#334155",color:"#94A3B8",border:"none",borderRadius:7,cursor:"pointer"}}>⚙ Gestión</button>
            :<button onClick={function(){setMode("operario");setShowForm(false);setEditing(null);}} style={{fontSize:12,padding:"5px 14px",background:"#78350F",color:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:7,cursor:"pointer"}}>← Operario</button>
          }
        </div>
      </div>

      {/* ── MONITOR KANBAN ── */}
      {view==="monitor"&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Form nuevo pedido */}
          {mode==="gestion"&&(
            <div style={{background:"#1E293B",borderBottom:"1px solid #334155",padding:"0.75rem 1.5rem"}}>
              {!showForm
                ?<button onClick={function(){setShowForm(true);}} style={{background:"#6366F1",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,padding:"7px 20px",cursor:"pointer"}}>+ Nuevo pedido</button>
                :<div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 180px"}}>
                    <div style={{fontSize:10,color:"#94A3B8",marginBottom:4,fontWeight:600,textTransform:"uppercase"}}>Cliente *</div>
                    <input placeholder="Nombre del cliente" value={form.cliente} onChange={function(e){setForm(Object.assign({},form,{cliente:e.target.value}));}} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569"})} autoFocus/>
                  </div>
                  <div style={{flex:"2 1 280px"}}>
                    <div style={{fontSize:10,color:"#94A3B8",marginBottom:4,fontWeight:600,textTransform:"uppercase"}}>Observaciones</div>
                    <input placeholder="Materiales, medidas..." value={form.observaciones} onChange={function(e){setForm(Object.assign({},form,{observaciones:e.target.value}));}} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569"})}/>
                  </div>
                  <div style={{flex:"0 0 100px"}}>
                    <div style={{fontSize:10,color:"#94A3B8",marginBottom:4,fontWeight:600,textTransform:"uppercase"}}>Nº Placas</div>
                    <input type="number" min="1" placeholder="0" value={form.cantidadPlacas} onChange={function(e){setForm(Object.assign({},form,{cantidadPlacas:e.target.value}));}} style={Object.assign({},inp,{background:"#0F172A",color:"#F1F5F9",border:"1px solid #475569",textAlign:"center",fontWeight:700})}/>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",padding:"7px 12px",borderRadius:8,border:"1.5px solid "+(form.canto?"#7C3AED":"#475569"),background:form.canto?"#2E1065":"#0F172A",whiteSpace:"nowrap"}}>
                    <input type="checkbox" checked={form.canto} onChange={function(e){setForm(Object.assign({},form,{canto:e.target.checked}));}} style={{width:15,height:15,accentColor:"#7C3AED",cursor:"pointer"}}/>
                    <span style={{fontSize:12,fontWeight:700,color:form.canto?"#C4B5FD":"#64748B"}}>{form.canto?"✓ Con canto":"Sin canto"}</span>
                  </label>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={addOrder} style={{background:"#22C55E",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,padding:"7px 18px",cursor:"pointer"}}>Cargar</button>
                    <button onClick={function(){setShowForm(false);setForm({cliente:"",observaciones:"",canto:false,cantidadPlacas:""}); }} style={{background:"#334155",color:"#94A3B8",border:"none",borderRadius:8,fontSize:13,padding:"7px 14px",cursor:"pointer"}}>✕</button>
                  </div>
                </div>
              }
            </div>
          )}

          {/* Kanban columns */}
          <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:0,overflow:"hidden",minHeight:0}}>
            {STAGES.map(function(stage){
              var items=orders.orders.filter(function(o){return o.stage===stage.key;});
              return (
                <div key={stage.key} style={{display:"flex",flexDirection:"column",borderRight:"1px solid #1E293B",overflow:"hidden"}}>
                  {/* Column header */}
                  <div style={{background:stage.key==="activo"?"#1E293B":"#0F172A",borderBottom:"2px solid "+stage.border,padding:"10px 12px",flexShrink:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                      <Dot color={stage.dot} size={8}/>
                      <span style={{fontSize:12,fontWeight:800,color:stage.fg==="#1E293B"?"#F1F5F9":stage.fg,letterSpacing:"0.04em"}}>{stage.label.toUpperCase()}</span>
                      <span style={{marginLeft:"auto",fontSize:14,fontWeight:800,color:stage.dot}}>{items.length}</span>
                    </div>
                    {stage.key==="cola_canteo"&&<div style={{fontSize:10,color:"#64748B"}}>tiempo muerto</div>}
                    {items.length>0&&(
                      <div style={{fontSize:10,color:"#64748B",marginTop:2}}>
                        {items.reduce(function(s,o){return s+(o.cantidadPlacas||0);},0)} placas
                      </div>
                    )}
                  </div>

                  {/* Cards */}
                  <div style={{flex:1,overflowY:"auto",padding:"8px",display:"flex",flexDirection:"column",gap:6,background:"#0F172A"}}>
                    {items.length===0?(
                      <div style={{border:"1px dashed #1E293B",borderRadius:8,padding:"1.5rem 0.5rem",textAlign:"center",color:"#334155",fontSize:12,marginTop:4}}>
                        vacío
                      </div>
                    ):items.map(function(order){
                      var stageTs=order.timestamps&&order.timestamps[order.stage];
                      var elapsed=stageTs?Date.now()-stageTs:null;
                      var ns=getNext(order);
                      var nsObj=ns?getStageObj(ns):null;
                      var payObj=getPayObj(order.payment||"sin_pago");
                      var isEditing=editing===order.id;

                      return (
                        <div key={order.id} style={{background:"#1E293B",border:"1px solid "+stage.border,borderRadius:10,overflow:"hidden",position:"relative",transition:"box-shadow 0.15s"}}>
                          {order.modified&&<div style={{position:"absolute",top:6,right:6,width:7,height:7,borderRadius:"50%",background:"#F97316",border:"1px solid #1E293B",zIndex:2}}/>}

                          <div style={{padding:"10px 10px 6px"}}>
                            {/* Numero + hora */}
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                              <span style={{fontFamily:"monospace",fontSize:10,color:"#64748B",background:"#0F172A",padding:"1px 6px",borderRadius:4}}>{order.numero}</span>
                              <span style={{fontSize:10,color:"#64748B",marginLeft:"auto"}}>{timeAgo(stageTs)}</span>
                            </div>

                            {/* Cliente */}
                            <div style={{fontSize:13,fontWeight:700,color:"#F1F5F9",marginBottom:4,lineHeight:1.3}}>{order.cliente}</div>

                            {/* Tags */}
                            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:order.observaciones?6:0}}>
                              {order.cantidadPlacas>0&&(
                                <span style={{fontSize:10,fontWeight:800,background:"#1D4ED8",color:"#BFDBFE",padding:"1px 7px",borderRadius:99}}>{order.cantidadPlacas}pl</span>
                              )}
                              <span style={{fontSize:10,fontWeight:700,background:order.canto?"#2E1065":"#0F172A",color:order.canto?"#C4B5FD":"#475569",padding:"1px 7px",borderRadius:99,border:"1px solid "+(order.canto?"#4C1D95":"#334155")}}>
                                {order.canto?"Con canto":"Sin canto"}
                              </span>
                              <span style={{fontSize:10,fontWeight:700,background:payObj.bg,color:payObj.fg,padding:"1px 7px",borderRadius:99,display:"inline-flex",alignItems:"center",gap:3}}>
                                <Dot color={payObj.dot} size={5}/>{payObj.label}
                              </span>
                            </div>

                            {/* Observaciones */}
                            {order.observaciones&&!isEditing&&(
                              <div style={{fontSize:11,color:"#94A3B8",lineHeight:1.5,borderLeft:"2px solid "+stage.border,paddingLeft:6,marginBottom:4,whiteSpace:"pre-wrap"}}>
                                {order.observaciones}
                              </div>
                            )}

                            {/* Tiempo en etapa */}
                            {elapsed&&elapsed>60000&&(
                              <div style={{fontSize:10,color:"#475569",marginTop:2}}>⏱ {fmt(elapsed)}</div>
                            )}
                          </div>

                          {/* Form edición inline */}
                          {isEditing&&(
                            <div style={{padding:"0 10px 10px"}} onClick={function(e){e.stopPropagation();}}>
                              <div style={{background:"#0F172A",borderRadius:8,padding:"8px",border:"1px solid #F97316"}}>
                                <input placeholder="Cliente *" value={editForm.cliente} onChange={function(e){setEditForm(Object.assign({},editForm,{cliente:e.target.value}));}} style={Object.assign({},inp,{marginBottom:6,background:"#1E293B",color:"#F1F5F9",border:"1px solid #475569",fontSize:12})}/>
                                <textarea placeholder="Observaciones..." value={editForm.observaciones} onChange={function(e){setEditForm(Object.assign({},editForm,{observaciones:e.target.value}));}} rows={2} style={Object.assign({},inp,{marginBottom:6,background:"#1E293B",color:"#F1F5F9",border:"1px solid #475569",resize:"none",lineHeight:1.4,fontSize:12})}/>
                                <div style={{display:"flex",gap:6}}>
                                  <button onClick={function(){saveEdit(order.id);}} style={{flex:1,background:"#F97316",color:"#fff",border:"none",fontSize:11,fontWeight:700,padding:"6px",borderRadius:6,cursor:"pointer"}}>Guardar</button>
                                  <button onClick={function(){setEditing(null);}} style={{fontSize:11,padding:"6px 10px",background:"#334155",color:"#94A3B8",border:"none",borderRadius:6,cursor:"pointer"}}>✕</button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Barra de acciones */}
                          <div style={{borderTop:"1px solid #0F172A",padding:"6px 8px",background:"rgba(0,0,0,0.2)",display:"flex",gap:4,alignItems:"center"}}>
                            {mode==="gestion"&&getPrev(order)&&(
                              <button onClick={function(){goBack(order.id);}} style={{fontSize:10,padding:"3px 7px",color:"#64748B",background:"#0F172A",border:"1px solid #334155",borderRadius:5,cursor:"pointer"}}>←</button>
                            )}
                            {ns?(
                              <HoldButton onAction={function(){advance(order.id);}} color={nsObj&&nsObj.dot} style={{flex:1,fontSize:11,padding:"5px 6px"}}>
                                → {nsObj&&nsObj.label}
                              </HoldButton>
                            ):(
                              <div style={{flex:1,fontSize:11,fontWeight:600,color:"#22C55E",textAlign:"center"}}>✓ Listo</div>
                            )}

                            {mode==="gestion"&&(
                              <div style={{display:"flex",gap:3}}>
                                {/* Pago rápido */}
                                {PAYMENT_OPTS.map(function(p){
                                  var active=(order.payment||"sin_pago")===p.key;
                                  return <button key={p.key} onClick={function(){updatePayment(order.id,p.key);}} title={p.label}
                                    style={{fontSize:9,padding:"3px 5px",borderRadius:4,cursor:"pointer",background:active?p.bg:"#0F172A",color:active?p.fg:"#475569",border:"1px solid "+(active?p.dot:"#334155"),fontWeight:700}}>
                                    <Dot color={p.dot} size={6}/>
                                  </button>;
                                })}
                                <button onClick={function(){setEditForm({cliente:order.cliente,observaciones:order.observaciones||"",canto:!!order.canto,cantidadPlacas:order.cantidadPlacas||""});setEditing(order.id);}} title="Editar" style={{fontSize:11,padding:"3px 6px",color:"#6366F1",background:"#0F172A",border:"1px solid #334155",borderRadius:4,cursor:"pointer"}}>✏</button>
                                {order.stage==="completado"&&<button onClick={function(){archiveNow(order.id);}} title="Archivar" style={{fontSize:11,padding:"3px 6px",color:"#3B82F6",background:"#0F172A",border:"1px solid #334155",borderRadius:4,cursor:"pointer"}}>📁</button>}
                                <button onClick={function(){deleteOrder(order.id);}} title="Eliminar" style={{fontSize:11,padding:"3px 6px",color:"#EF4444",background:"#0F172A",border:"1px solid #334155",borderRadius:4,cursor:"pointer"}}>🗑</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {view==="historial"&&(
        <div style={{flex:1,overflowY:"auto",padding:"1.5rem",maxWidth:900,margin:"0 auto",width:"100%"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <div style={{fontSize:15,fontWeight:700,color:"#F1F5F9"}}>🗂 Historial de pedidos</div>
            {mode==="gestion"&&history.items.length>0&&<button onClick={clearHist} style={{fontSize:12,padding:"5px 12px",color:"#EF4444",background:"#1E293B",border:"1px solid #334155",borderRadius:7,cursor:"pointer"}}>🗑 Borrar todo</button>}
          </div>
          {history.items.length===0?(
            <div style={{border:"1px dashed #334155",borderRadius:10,padding:"3rem",textAlign:"center",color:"#475569",fontSize:13}}>
              <div style={{fontSize:32,marginBottom:8}}>🗂</div>
              Los pedidos completados aparecen acá después de 24h.
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {history.items.map(function(order){
                var total=order.timestamps&&order.timestamps.completado&&order.timestamps.activo?order.timestamps.completado-order.timestamps.activo:null;
                var payObj=getPayObj(order.payment||"sin_pago");
                return (
                  <div key={order.id} style={{background:"#1E293B",border:"1px solid #334155",borderRadius:10,padding:"0.75rem 1rem"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontSize:11,color:"#64748B"}}>{order.numero}</span>
                      <span style={{fontWeight:700,fontSize:13,color:"#F1F5F9"}}>{order.cliente}</span>
                      {order.cantidadPlacas>0&&<span style={{fontSize:10,background:"#1D4ED8",color:"#BFDBFE",padding:"1px 7px",borderRadius:99,fontWeight:700}}>{order.cantidadPlacas}pl</span>}
                      <span style={{fontSize:10,background:order.canto?"#2E1065":"#0F172A",color:order.canto?"#C4B5FD":"#64748B",padding:"1px 7px",borderRadius:99,fontWeight:700,border:"1px solid "+(order.canto?"#4C1D95":"#334155")}}>{order.canto?"Con canto":"Sin canto"}</span>
                      <span style={{fontSize:10,fontWeight:700,background:payObj.bg,color:payObj.fg,padding:"1px 7px",borderRadius:99}}>{payObj.label}</span>
                      {total&&<span style={{fontSize:11,background:"#14532D",color:"#86EFAC",padding:"2px 9px",borderRadius:99,fontWeight:700,marginLeft:"auto"}}>{fmt(total)} total</span>}
                    </div>
                    {order.observaciones&&<div style={{fontSize:12,color:"#64748B",whiteSpace:"pre-wrap",lineHeight:1.5,marginTop:5}}>{order.observaciones}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
