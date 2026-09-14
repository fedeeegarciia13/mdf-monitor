import { useState, useEffect, useCallback, useRef } from "react";

const PEDIDOS_TABLE     = "pedidos";
const PIN               = "1234";
const ARCHIVE_AFTER_MIN = 1440;
const HOLD_MS           = 800;
const TICK_MS           = 20;

const STAGES = [
  { key:"activo",      label:"Activos",     short:"Activos",  dot:"#64748B", bg:"#F1F5F9", fg:"#1E293B", border:"#CBD5E1" },
  { key:"preparacion", label:"Preparación", short:"Prep.",    dot:"#6366F1", bg:"#EEF2FF", fg:"#312E81", border:"#6366F1" },
  { key:"corte",       label:"Corte",       short:"Corte",    dot:"#EF4444", bg:"#FEE2E2", fg:"#7F1D1D", border:"#EF4444" },
  { key:"cola_canteo", label:"Cola Canteo", short:"Cola",     dot:"#F97316", bg:"#FFF7ED", fg:"#7C2D12", border:"#F97316" },
  { key:"canteo",      label:"Canteo",      short:"Canteo",   dot:"#F59E0B", bg:"#FEF3C7", fg:"#78350F", border:"#F59E0B" },
  { key:"completado",  label:"Completados", short:"Listo",    dot:"#22C55E", bg:"#DCFCE7", fg:"#14532D", border:"#22C55E" },
];
const SEQ_CON = ["activo","preparacion","corte","cola_canteo","canteo","completado"];
const SEQ_SIN = ["activo","preparacion","corte","completado"];

const PAYMENT_OPTS = [
  { key:"sin_pago", label:"Sin pago",     dot:"#EF4444", bg:"#FEE2E2", fg:"#7F1D1D" },
  { key:"parcial",  label:"Pago parcial", dot:"#F59E0B", bg:"#FEF3C7", fg:"#78350F" },
  { key:"pagado",   label:"Pagado",       dot:"#22C55E", bg:"#DCFCE7", fg:"#14532D" },
];


const SUPABASE_URL = "https://ykygszjqqnkgqjowbanj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlreWdzempxcW5rZ3Fqb3diYW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTExMDMsImV4cCI6MjA5NTk4NzEwM30.K24YPH1WeN7eUGpG2OJqfxYCYfNFm5DOxwWiictT_3Y";

class VersionConflictError extends Error {}

async function sbSelect(query) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/"+PEDIDOS_TABLE+"?"+query,{
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
  });
  return await res.json();
}
async function sbInsert(fields) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/"+PEDIDOS_TABLE,{
    method:"POST",
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"return=representation"},
    body:JSON.stringify(fields)
  });
  const rows = await res.json();
  if (!rows || !rows[0]) throw new Error("No se pudo insertar");
  return rows[0];
}
async function sbPatchOne(id,fields,expectedVersion) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/"+PEDIDOS_TABLE+"?id=eq."+id+"&version=eq."+expectedVersion,{
    method:"PATCH",
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"return=representation"},
    body:JSON.stringify(Object.assign({},fields,{version:expectedVersion+1,updated_at:new Date().toISOString()}))
  });
  const rows = await res.json();
  if (!rows || rows.length===0) throw new VersionConflictError();
  return rows[0];
}
async function sbPatchBulk(query,fields) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/"+PEDIDOS_TABLE+"?"+query,{
    method:"PATCH",
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"return=representation"},
    body:JSON.stringify(fields)
  });
  return await res.json();
}
async function sbDelete(query) {
  const res = await fetch(SUPABASE_URL+"/rest/v1/"+PEDIDOS_TABLE+"?"+query,{
    method:"DELETE",
    headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Prefer":"return=representation"}
  });
  return await res.json();
}

function tsToIso(ms){ return ms==null?null:new Date(ms).toISOString(); }
function isoToMs(iso){ return iso==null?null:new Date(iso).getTime(); }

function rowToOrder(row) {
  return {
    id:row.id, numero:row.numero||("PED-"+String(row.numero_seq).padStart(4,"0")), cliente:row.cliente, observaciones:row.observaciones,
    canto:row.canto, cantidadPlacas:row.cantidad_placas, stage:row.stage, payment:row.payment,
    modified:row.modified, modifiedAt:isoToMs(row.modified_at),
    fechaIngreso:isoToMs(row.fecha_ingreso), hora:row.hora,
    timestamps:row.timestamps||{}, archived:row.archived, version:row.version,
  };
}
function orderToRowFields(fields) {
  var out={};
  if ("cliente" in fields) out.cliente=fields.cliente;
  if ("observaciones" in fields) out.observaciones=fields.observaciones;
  if ("canto" in fields) out.canto=fields.canto;
  if ("cantidadPlacas" in fields) out.cantidad_placas=fields.cantidadPlacas;
  if ("modified" in fields) out.modified=fields.modified;
  if ("modifiedAt" in fields) out.modified_at=tsToIso(fields.modifiedAt);
  if ("payment" in fields) out.payment=fields.payment;
  if ("stage" in fields) out.stage=fields.stage;
  if ("timestamps" in fields) out.timestamps=fields.timestamps;
  if ("archived" in fields) out.archived=fields.archived;
  return out;
}

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
  if (m<1) return "recién"; if (m<60) return "hace "+m+" min";
  var h=Math.floor(m/60); if (h<24) return "hace "+h+"h";
  return "hace "+Math.floor(h/24)+"d";
}

function formatDate(ts) {
  if (!ts) return "";
  var d=new Date(ts);
  var dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  var meses=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return dias[d.getDay()]+" "+d.getDate()+" "+meses[d.getMonth()]+" · "+d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0");
}

function isToday(ts) {
  if (!ts) return false;
  var a=new Date(ts),b=new Date();
  return a.getDate()===b.getDate()&&a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear();
}

function stageTime(o,from,to){ var a=o.timestamps&&o.timestamps[from],b=o.timestamps&&o.timestamps[to]; return a&&b&&b>a?b-a:null; }
function calcAvg(arr){ var v=arr.filter(Boolean); return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:null; }
function calcMin(arr){ var v=arr.filter(Boolean); return v.length?Math.min.apply(null,v):null; }
function calcMax(arr){ var v=arr.filter(Boolean); return v.length?Math.max.apply(null,v):null; }

function Dot(p) {
  return <span style={{display:"inline-block",width:p.size||9,height:p.size||9,borderRadius:"50%",background:p.color,flexShrink:0}}/>;
}

function HoldButton(p) {
  var [progress,setProgress]=useState(0),[holding,setHolding]=useState(false);
  var timer=useRef(null),elapsed=useRef(0);
  function start(e){ e.preventDefault(); elapsed.current=0; setProgress(0); setHolding(true);
    timer.current=setInterval(function(){
      elapsed.current+=TICK_MS;
      var pct=Math.min((elapsed.current/HOLD_MS)*100,100); setProgress(pct);
      if(elapsed.current>=HOLD_MS){clearInterval(timer.current);setHolding(false);setProgress(0);p.onAction();}
    },TICK_MS);
  }
  function cancel(){ clearInterval(timer.current); setHolding(false); setProgress(0); elapsed.current=0; }
  return (
    <button onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel}
      onContextMenu={function(e){e.preventDefault();}}
      style={Object.assign({position:"relative",overflow:"hidden",background:p.color||"#22C55E",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,padding:"8px 12px",cursor:"pointer",userSelect:"none",touchAction:"none"},p.style||{})}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:progress+"%",background:"rgba(255,255,255,0.35)",pointerEvents:"none"}}/>
      <span style={{position:"relative",zIndex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
        {holding?<span style={{fontSize:11,opacity:0.9}}>Mantené presionado…</span>:p.children}
      </span>
    </button>
  );
}

function StatRow(p) {
  var a=calcAvg(p.values),mn=calcMin(p.values),mx=calcMax(p.values),n=p.values.filter(Boolean).length;
  if (!a) return (
    <div style={{background:"#F8FAFC",borderRadius:10,padding:"0.75rem 1rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span style={{fontSize:13,color:"#64748B"}}>{p.label}</span>
      <span style={{fontSize:12,color:"#CBD5E1"}}>Sin datos</span>
    </div>
  );
  return (
    <div style={{background:p.bg,borderRadius:10,padding:"0.875rem 1rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}><Dot color={p.color} size={8}/><span style={{fontSize:13,fontWeight:600,color:"#1E293B"}}>{p.label}</span></div>
        <span style={{fontSize:20,fontWeight:800,color:p.color}}>{fmt(a)}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
        {[["Promedio",a],["Mínimo",mn],["Máximo",mx]].map(function(item){
          return <div key={item[0]} style={{background:"rgba(255,255,255,0.6)",borderRadius:6,padding:"5px 8px",textAlign:"center"}}>
            <div style={{fontSize:10,color:"#64748B",marginBottom:2}}>{item[0]}</div>
            <div style={{fontSize:13,fontWeight:700,color:p.color}}>{fmt(item[1])}</div>
          </div>;
        })}
      </div>
      <div style={{fontSize:11,color:"#64748B",marginTop:6,textAlign:"right"}}>{n} pedido{n!==1?"s":""}</div>
    </div>
  );
}

export default function App() {
  var [pedidos, setPedidos] = useState(null);
  var [mode,    setMode]    = useState("operario");
  var [view,    setView]    = useState("monitor");
  var [toast,   setToast]   = useState(null);
  var [pin,     setPin]     = useState(false);
  var [pinVal,  setPinVal]  = useState("");
  var [showForm,setShowForm]= useState(false);
  var [form,    setForm]    = useState({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
  var [expanded,setExpanded]= useState({});
  var [editing, setEditing] = useState(null);
  var [editForm,setEditForm]= useState({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
  var [scope,   setScope]   = useState("hoy");
  var [filter,  setFilter]  = useState("todos");
  var [tick,    setTick]    = useState(Date.now());
  var [saveError, setSaveError] = useState(null);
  var lastWrite = useRef(0);

  function toast_(msg,type){ setToast({msg:msg,type:type||"ok"}); setTimeout(function(){setToast(null);},2800); }

  useEffect(function(){ var id=setInterval(function(){setTick(Date.now());},30000); return function(){clearInterval(id);}; },[]);

  var loadActivos = useCallback(async function(){
    if (Date.now()-lastWrite.current<5000) return;
    try {
      var rows=await sbSelect("archived=eq.false&order=fecha_ingreso.asc");
      var mapped=rows.map(rowToOrder);
      setPedidos(function(prev){ return mapped.concat((prev||[]).filter(function(o){return o.archived;})); });
    } catch(e){ setPedidos(function(prev){return prev||[];}); }
  },[]);

  var loadArchivados = useCallback(async function(){
    if (Date.now()-lastWrite.current<5000) return;
    try {
      var rows=await sbSelect("archived=eq.true&order=fecha_ingreso.asc");
      var mapped=rows.map(rowToOrder);
      setPedidos(function(prev){ return (prev||[]).filter(function(o){return !o.archived;}).concat(mapped); });
    } catch(e){ setPedidos(function(prev){return prev||[];}); }
  },[]);

  useEffect(function(){
    loadActivos(); loadArchivados();
    var id=setInterval(function(){loadActivos();loadArchivados();},5000);
    return function(){clearInterval(id);};
  },[loadActivos,loadArchivados]);

  // Patrón compartido por saveEdit/updatePayment/advance/goBack/archiveNow:
  // UPDATE de una sola fila, optimista, con rollback o refetch puntual si falla.
  function mutateOne(id,buildFields){
    var row=(pedidos||[]).find(function(o){return o.id===id;});
    if (!row) return;
    var fields=buildFields(row);
    if (!fields || Object.keys(fields).length===0) return;
    var optimisticRow=Object.assign({},row,fields);
    setPedidos(function(prev){ return (prev||[]).map(function(o){return o.id===id?optimisticRow:o;}); });
    lastWrite.current=Date.now();
    sbPatchOne(id,orderToRowFields(fields),row.version).then(function(updated){
      setPedidos(function(prev){ return (prev||[]).map(function(o){return o.id===id?rowToOrder(updated):o;}); });
      setSaveError(null);
    }).catch(function(e){
      lastWrite.current=0;
      if (e instanceof VersionConflictError) {
        setSaveError("Otro dispositivo guardó un cambio en este pedido justo antes que vos. Actualicé la vista con lo último — repetí tu acción si hace falta.");
        sbSelect("id=eq."+id).then(function(fresh){
          if (fresh&&fresh[0]) setPedidos(function(prev){ return (prev||[]).map(function(o){return o.id===id?rowToOrder(fresh[0]):o;}); });
        }).catch(function(){});
      } else {
        setPedidos(function(prev){ return (prev||[]).map(function(o){return o.id===id?row:o;}); });
        setSaveError("No se pudo guardar el último cambio. No se perdió nada — el pedido sigue como estaba antes. Reintentá.");
      }
    });
  }

  // Auto-archivar solo en tick (evita race conditions)
  useEffect(function(){
    if (!pedidos) return;
    var cutoff=Date.now()-ARCHIVE_AFTER_MIN*60*1000;
    var toArchive=pedidos.filter(function(o){
      return !o.archived&&o.stage==="completado"&&o.timestamps&&o.timestamps.completado&&o.timestamps.completado<cutoff;
    });
    if (!toArchive.length) return;
    var ids=toArchive.map(function(o){return o.id;});
    setPedidos(function(prev){
      return (prev||[]).map(function(o){return ids.indexOf(o.id)!==-1?Object.assign({},o,{archived:true}):o;});
    });
    lastWrite.current=Date.now();
    sbPatchBulk("id=in.("+ids.join(",")+")&archived=eq.false",{archived:true}).catch(function(){
      lastWrite.current=0; // el proximo poll corrige el estado optimista si esto fallo
    });
  },[tick]); // eslint-disable-line

  function addOrder(){
    if (!form.cliente.trim()){ toast_("Ingresá el nombre del cliente","err"); return; }
    var ts=Date.now();
    var fields={
      numero:"", // sin numero fijo: lo derivamos abajo del numero_seq atomico que asigna la DB
      cliente:form.cliente.trim(), observaciones:form.observaciones.trim(),
      canto:form.canto, cantidad_placas:parseInt(form.cantidadPlacas)||0,
      stage:"activo", payment:"sin_pago",
      fecha_ingreso:new Date(ts).toISOString(),
      hora:new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}),
      timestamps:{activo:ts},
    };
    lastWrite.current=Date.now();
    sbInsert(fields).then(function(row){
      var mapped=rowToOrder(row);
      setPedidos(function(prev){ return (prev||[]).concat([mapped]); });
      setForm({cliente:"",observaciones:"",canto:false,cantidadPlacas:""});
      setShowForm(false);
      setSaveError(null);
      toast_(mapped.numero+" cargado");
    }).catch(function(){
      lastWrite.current=0;
      setSaveError("No se pudo cargar el pedido. No se guardó nada — reintentá.");
    });
  }

  function saveEdit(id){
    if (!editForm.cliente.trim()){ toast_("El cliente no puede estar vacío","err"); return; }
    mutateOne(id,function(){
      return {
        cliente:editForm.cliente.trim(), observaciones:editForm.observaciones.trim(),
        canto:editForm.canto, cantidadPlacas:parseInt(editForm.cantidadPlacas)||0,
        modified:true, modifiedAt:Date.now(),
      };
    });
    setEditing(null); toast_("Pedido actualizado");
  }

  function updatePayment(id,pay){ mutateOne(id,function(){ return {payment:pay}; }); }

  function advance(id){
    var ts=Date.now();
    mutateOne(id,function(o){
      var next=getNext(o); if(!next) return {};
      var t=Object.assign({},o.timestamps); t[next]=ts;
      return {stage:next,timestamps:t};
    });
  }

  function goBack(id){
    mutateOne(id,function(o){
      var prev=getPrev(o); if(!prev) return {};
      var t=Object.assign({},o.timestamps); delete t[o.stage];
      return {stage:prev,timestamps:t};
    });
  }

  function deleteOrder(id){
    var prevPedidos=pedidos;
    var row=(pedidos||[]).find(function(o){return o.id===id;});
    if (!row) return;
    setPedidos(function(prev){ return (prev||[]).filter(function(o){return o.id!==id;}); });
    lastWrite.current=Date.now();
    sbDelete("id=eq."+id).then(function(deletedRows){
      if (!deletedRows||deletedRows.length===0){
        lastWrite.current=0;
        setPedidos(prevPedidos);
        setSaveError("No se pudo eliminar "+row.numero+": los pedidos activos de más de 15 minutos no se pueden borrar (protección contra borrados accidentales). Si hace falta borrarlo, archivalo primero o pedí que lo borren directo en la base.");
        return;
      }
      setSaveError(null);
      toast_("Eliminado");
    }).catch(function(){
      lastWrite.current=0;
      setPedidos(prevPedidos);
      setSaveError("No se pudo eliminar el pedido. No se perdió nada. Reintentá.");
    });
  }

  function archiveNow(id){
    mutateOne(id,function(){ return {archived:true}; });
    toast_("Movido al historial");
  }

  function clearHist(){
    if(!window.confirm("¿Borrar todo el historial?")) return;
    var prevPedidos=pedidos;
    setPedidos(function(prev){ return (prev||[]).filter(function(o){return !o.archived;}); });
    lastWrite.current=Date.now();
    sbDelete("archived=eq.true").then(function(){
      setSaveError(null);
      toast_("Historial borrado");
    }).catch(function(){
      lastWrite.current=0;
      setPedidos(prevPedidos);
      setSaveError("No se pudo borrar el historial. No se perdió nada. Reintentá.");
    });
  }

  function openPin(){ setPin(true); setPinVal(""); }
  function checkPin(){ if(pinVal===PIN){setMode("gestion");setPin(false);} else{toast_("PIN incorrecto","err");setPinVal("");} }
  function toggleExpand(id){ setExpanded(function(e){return Object.assign({},e,{[id]:!e[id]});}); }

  if (!pedidos) return <div style={{padding:"3rem",textAlign:"center",color:"#94A3B8"}}>⏳ Cargando...</div>;

  var activos    = pedidos.filter(function(o){return !o.archived;});
  var archivados = pedidos.filter(function(o){return o.archived;});
  var allDone  = pedidos.filter(function(o){return o.stage==="completado";});
  var byScope  = scope==="hoy"?allDone.filter(function(o){return isToday(o.fechaIngreso||o.timestamps&&o.timestamps.activo);}):allDone;
  var byFilter = filter==="canto"?byScope.filter(function(o){return o.canto;}):filter==="sincanto"?byScope.filter(function(o){return !o.canto;}):byScope;
  var wCanto   = byFilter.filter(function(o){return o.canto;}), woCanto=byFilter.filter(function(o){return !o.canto;});
  var todayAll = allDone.filter(function(o){return isToday(o.fechaIngreso||o.timestamps&&o.timestamps.activo);});
  var tPrep=byFilter.map(function(o){return stageTime(o,"preparacion","corte");});
  var tCorte=byFilter.map(function(o){return o.canto?stageTime(o,"corte","cola_canteo"):stageTime(o,"corte","completado");});
  var tEsp=wCanto.map(function(o){return stageTime(o,"cola_canteo","canteo");});
  var tCant=wCanto.map(function(o){return stageTime(o,"canteo","completado");});
  var tTot=byFilter.map(function(o){return stageTime(o,"activo","completado");});

  var inp={fontSize:13,padding:"8px 10px",borderRadius:8,border:"1px solid #CBD5E1",background:"#fff",width:"100%",boxSizing:"border-box"};

  return (
    <div style={{fontFamily:"system-ui,sans-serif",padding:"0.875rem",maxWidth:860,margin:"0 auto"}}>

      {toast&&<div style={{position:"sticky",top:0,zIndex:20,marginBottom:12,background:toast.type==="err"?"#FEE2E2":"#DCFCE7",color:toast.type==="err"?"#7F1D1D":"#14532D",padding:"0.5rem 1rem",borderRadius:10,fontSize:13,fontWeight:500}}>{toast.msg}</div>}

      {saveError&&<div style={{position:"sticky",top:0,zIndex:21,marginBottom:12,background:"#FEE2E2",color:"#7F1D1D",padding:"0.6rem 1rem",borderRadius:10,fontSize:13,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,border:"1.5px solid #EF4444"}}>
        <span>⚠ {saveError}</span>
        <button onClick={function(){setSaveError(null);}} style={{background:"transparent",border:"none",color:"#7F1D1D",fontWeight:700,cursor:"pointer",fontSize:14}}>✕</button>
      </div>}

      {pin&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:16,padding:"1.5rem",width:260,boxShadow:"0 8px 32px rgba(0,0,0,0.18)"}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Acceso a Gestión</div>
            <div style={{fontSize:13,color:"#64748B",marginBottom:16}}>Ingresá el PIN para continuar</div>
            <input type="password" placeholder="PIN" value={pinVal} autoFocus
              onChange={function(e){setPinVal(e.target.value);}}
              onKeyDown={function(e){if(e.key==="Enter")checkPin();}}
              style={Object.assign({},inp,{fontSize:20,textAlign:"center",letterSpacing:8,marginBottom:12})}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={checkPin} style={{flex:1,background:"#1E293B",color:"#fff",border:"none",fontSize:14,padding:"8px",borderRadius:8}}>Entrar</button>
              <button onClick={function(){setPin(false);}} style={{fontSize:14,padding:"8px 14px"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
        <div>
          <div style={{fontSize:17,fontWeight:700}}>📋 Monitor de producción</div>
          <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>Tiempo real · cada 5 seg</div>
        </div>
        {mode==="operario"
          ?<button onClick={openPin} style={{fontSize:12,padding:"5px 12px"}}>⚙ Gestión</button>
          :<button onClick={function(){setMode("operario");setShowForm(false);setEditing(null);setView("monitor");}} style={{fontSize:12,padding:"5px 12px",background:"#FEF3C7",color:"#78350F",border:"1px solid #F59E0B"}}>← Operario</button>
        }
      </div>

      {/* Nav */}
      <div style={{display:"flex",background:"#F1F5F9",borderRadius:10,padding:3,marginBottom:"1.25rem"}}>
        {[["monitor","Monitor"],["resumen","Estadísticas"],["historial","Historial ("+archivados.length+")"]].map(function(item){
          return <button key={item[0]} onClick={function(){setView(item[0]);}} style={{flex:1,fontSize:12,fontWeight:600,padding:"7px 8px",background:view===item[0]?"#fff":"transparent",color:view===item[0]?"#1E293B":"#64748B",border:"none",borderRadius:8,boxShadow:view===item[0]?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>{item[1]}</button>;
        })}
      </div>

      {/* ══ MONITOR ══ */}
      {view==="monitor"&&(
        <div>
          {/* Contadores */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:"1.25rem"}}>
            {STAGES.map(function(s){
              var count=activos.filter(function(o){return o.stage===s.key;}).length;
              return <div key={s.key} style={{background:s.bg,border:"1.5px solid "+s.border,borderRadius:12,padding:"0.6rem 0.75rem",textAlign:"center"}}>
                <div style={{fontSize:26,fontWeight:700,color:s.fg,lineHeight:1}}>{count}</div>
                <div style={{fontSize:10,fontWeight:600,color:s.fg,marginTop:3,opacity:0.85}}>{s.short}</div>
              </div>;
            })}
          </div>

          {/* Panel de placas — solo gestión */}
          {mode==="gestion"&&(
            <div style={{background:"#EFF6FF",border:"1.5px solid #BFDBFE",borderRadius:12,padding:"0.75rem 1rem",marginBottom:"1.25rem"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#1D4ED8",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>📦 Placas en producción</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                {STAGES.filter(function(s){return s.key!=="completado";}).map(function(s){
                  var total=activos.filter(function(o){return o.stage===s.key;}).reduce(function(sum,o){return sum+(o.cantidadPlacas||0);},0);
                  return <div key={s.key} style={{background:"#fff",borderRadius:8,padding:"6px 4px",textAlign:"center",border:"1px solid #DBEAFE"}}>
                    <div style={{fontSize:18,fontWeight:800,color:s.dot,lineHeight:1}}>{total}</div>
                    <div style={{fontSize:9,color:"#64748B",marginTop:2}}>{s.short}</div>
                  </div>;
                })}
              </div>
              <div style={{fontSize:11,color:"#1D4ED8",marginTop:8,textAlign:"right",fontWeight:500}}>
                Total en proceso: {activos.filter(function(o){return o.stage!=="completado";}).reduce(function(sum,o){return sum+(o.cantidadPlacas||0);},0)} placas
              </div>
            </div>
          )}

          {/* Nuevo pedido */}
          {mode==="gestion"&&(
            <div style={{marginBottom:"1.25rem"}}>
              {!showForm
                ?<button onClick={function(){setShowForm(true);}} style={{width:"100%",padding:"10px",background:"#1E293B",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:600}}>+ Nuevo pedido</button>
                :<div style={{background:"#F8FAFC",border:"1.5px solid #3B82F6",borderRadius:12,padding:"1rem"}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Nuevo pedido</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <input placeholder="Cliente *" value={form.cliente} onChange={function(e){setForm(Object.assign({},form,{cliente:e.target.value}));}} style={inp}/>
                    <textarea
                      placeholder="Observaciones: materiales, medidas, instrucciones especiales..."
                      value={form.observaciones}
                      onChange={function(e){setForm(Object.assign({},form,{observaciones:e.target.value}));}}
                      rows={5}
                      style={Object.assign({},inp,{resize:"vertical",lineHeight:1.6})}
                    />
                    <input
                      type="number" min="1" placeholder="Cantidad de placas (número)"
                      value={form.cantidadPlacas}
                      onChange={function(e){setForm(Object.assign({},form,{cantidadPlacas:e.target.value}));}}
                      style={Object.assign({},inp,{textAlign:"center",fontWeight:700})}
                    />
                    <label style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none",padding:"10px 12px",borderRadius:10,border:"2px solid "+(form.canto?"#7C3AED":"#E2E8F0"),background:form.canto?"#EDE9FE":"#F8FAFC"}}>
                      <input type="checkbox" checked={form.canto} onChange={function(e){setForm(Object.assign({},form,{canto:e.target.checked}));}} style={{width:18,height:18,accentColor:"#7C3AED",cursor:"pointer",flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:form.canto?"#4C1D95":"#1E293B"}}>{form.canto?"✓ Lleva canto":"Sin canto"}</div>
                        <div style={{fontSize:11,color:form.canto?"#6D28D9":"#94A3B8",marginTop:1}}>{form.canto?"→ Corte → Cola Canteo → Canteo → Listo":"→ Corte → Listo (saltea Canteo)"}</div>
                      </div>
                    </label>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    <button onClick={addOrder} style={{flex:1,background:"#1E293B",color:"#fff",border:"none",fontSize:13,fontWeight:600,padding:"9px",borderRadius:8}}>Cargar pedido</button>
                    <button onClick={function(){setShowForm(false);setForm({cliente:"",observaciones:"",canto:false,cantidadPlacas:""}); }} style={{fontSize:13,padding:"9px 14px"}}>Cancelar</button>
                  </div>
                </div>
              }
            </div>
          )}

          {/* Etapas */}
          {STAGES.map(function(stage){
            var items=activos.filter(function(o){return o.stage===stage.key;});
            return (
              <div key={stage.key} style={{marginBottom:"1.5rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <Dot color={stage.dot} size={10}/>
                  <span style={{fontSize:13,fontWeight:700,color:stage.fg,textTransform:"uppercase",letterSpacing:"0.06em"}}>{stage.label}</span>
                  <span style={{fontSize:12,background:stage.bg,color:stage.fg,padding:"1px 8px",borderRadius:99,fontWeight:700}}>{items.length}</span>
                  {stage.key==="cola_canteo"&&<span style={{fontSize:11,color:"#94A3B8"}}>— tiempo muerto</span>}
                  {stage.key==="completado"&&items.length>0&&<span style={{marginLeft:"auto",fontSize:11,color:"#94A3B8"}}>Se archivan en 24h</span>}
                </div>

                {items.length===0
                  ?<div style={{border:"1px dashed "+stage.border,borderRadius:10,padding:"1.25rem",textAlign:"center",color:"#94A3B8",fontSize:13}}>Sin pedidos</div>
                  :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {items.map(function(order){
                      var stageTs=order.timestamps&&order.timestamps[order.stage];
                      var elapsed=stageTs?Date.now()-stageTs:null;
                      var ns=getNext(order),nsObj=ns?getStageObj(ns):null;
                      var payObj=getPayObj(order.payment||"sin_pago");
                      var isOpen=!!expanded[order.id],isEdit=editing===order.id;
                      var fechaIngreso=order.fechaIngreso||order.timestamps&&order.timestamps.activo;

                      return (
                        <div key={order.id} style={{background:"#fff",border:"1.5px solid "+stage.border,borderRadius:12,overflow:"hidden",position:"relative"}}>

                          {/* Puntito modificado */}
                          {order.modified&&(
                            <div title={"Modificado "+timeAgo(order.modifiedAt)} style={{position:"absolute",top:8,right:8,width:10,height:10,borderRadius:"50%",background:"#F97316",border:"2px solid #fff",zIndex:5}}/>
                          )}

                          {/* Cabecera */}
                          <div onClick={function(){if(!isEdit)toggleExpand(order.id);}} style={{padding:"0.875rem 1rem",cursor:"pointer",userSelect:"none"}}>

                            {/* Fecha de ingreso — siempre visible */}
                            <div style={{fontSize:11,fontWeight:600,color:"#fff",background:"#334155",borderRadius:6,padding:"3px 8px",display:"inline-flex",alignItems:"center",gap:5,marginBottom:8}}>
                              📅 Ingreso: {formatDate(fechaIngreso)}
                            </div>

                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap",paddingRight:order.modified?18:0}}>
                              <span style={{fontWeight:700,fontSize:15,color:"#1E293B"}}>{order.numero}</span>
                              <span style={{fontSize:15,color:"#1E293B",fontWeight:500}}>{order.cliente}</span>
                              {order.cantidadPlacas>0&&<span style={{fontSize:11,fontWeight:700,background:"#EFF6FF",color:"#1D4ED8",padding:"2px 8px",borderRadius:99}}>{order.cantidadPlacas} placa{order.cantidadPlacas!==1?"s":""}</span>}
                              <span style={{fontSize:11,fontWeight:700,background:order.canto?"#EDE9FE":"#F1F5F9",color:order.canto?"#4C1D95":"#64748B",padding:"2px 8px",borderRadius:99}}>{order.canto?"Con canto":"Sin canto"}</span>
                              <span style={{marginLeft:"auto",fontSize:11,color:"#94A3B8"}}>{timeAgo(stageTs)} en esta etapa</span>
                            </div>

                            {order.observaciones&&!isEdit&&(
                              <div style={{fontSize:13,color:"#334155",lineHeight:1.6,background:"#F8FAFC",borderRadius:8,padding:"8px 10px",borderLeft:"3px solid "+stage.border,whiteSpace:"pre-wrap",marginBottom:4}}>
                                {order.observaciones}
                              </div>
                            )}

                            {elapsed&&elapsed>0&&!isEdit&&(
                              <div style={{fontSize:11,color:"#94A3B8",marginTop:4}}>⏱ {fmt(elapsed)} en esta etapa</div>
                            )}

                            {/* Panel expandido */}
                            {isOpen&&!isEdit&&(
                              <div style={{marginTop:10,padding:"10px 12px",background:"#F8FAFC",borderRadius:10,border:"1px solid #E2E8F0"}}>
                                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:mode==="gestion"?10:0}}>
                                  <span style={{fontSize:12,color:"#64748B",fontWeight:600}}>Pago:</span>
                                  <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,fontWeight:700,background:payObj.bg,color:payObj.fg,padding:"3px 10px",borderRadius:99}}>
                                    <Dot color={payObj.dot} size={7}/>{payObj.label}
                                  </span>
                                </div>
                                {mode==="gestion"&&(
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                                    {PAYMENT_OPTS.map(function(p){
                                      var active=(order.payment||"sin_pago")===p.key;
                                      return <button key={p.key} onClick={function(e){e.stopPropagation();updatePayment(order.id,p.key);}} style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:99,cursor:"pointer",background:active?p.bg:"#F1F5F9",color:active?p.fg:"#64748B",border:"1.5px solid "+(active?p.dot:"#E2E8F0"),display:"inline-flex",alignItems:"center",gap:4}}>
                                        <Dot color={p.dot} size={6}/>{p.label}
                                      </button>;
                                    })}
                                  </div>
                                )}
                                {order.modified&&<div style={{marginTop:8,fontSize:11,color:"#94A3B8",display:"flex",alignItems:"center",gap:5}}><Dot color="#F97316" size={7}/>Modificado {timeAgo(order.modifiedAt)}</div>}
                              </div>
                            )}
                          </div>

                          {/* Formulario edición */}
                          {isEdit&&(
                            <div style={{padding:"0 1rem 1rem"}} onClick={function(e){e.stopPropagation();}}>
                              <div style={{background:"#FFF7ED",border:"1.5px solid #F97316",borderRadius:10,padding:"0.875rem"}}>
                                <div style={{fontSize:12,fontWeight:700,color:"#7C2D12",marginBottom:10}}>✏️ Editando</div>
                                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                                  <input placeholder="Cliente *" value={editForm.cliente} onChange={function(e){setEditForm(Object.assign({},editForm,{cliente:e.target.value}));}} style={inp}/>
                                  <textarea placeholder="Observaciones..." value={editForm.observaciones} onChange={function(e){setEditForm(Object.assign({},editForm,{observaciones:e.target.value}));}} rows={3} style={Object.assign({},inp,{resize:"vertical"})}/>
                                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}}>
                                    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"8px 10px",borderRadius:8,border:"1.5px solid "+(editForm.canto?"#7C3AED":"#E2E8F0"),background:editForm.canto?"#EDE9FE":"#F8FAFC"}}>
                                      <input type="checkbox" checked={editForm.canto} onChange={function(e){setEditForm(Object.assign({},editForm,{canto:e.target.checked}));}} style={{width:16,height:16,accentColor:"#7C3AED"}}/>
                                      <span style={{fontSize:13,fontWeight:600,color:editForm.canto?"#4C1D95":"#64748B"}}>{editForm.canto?"✓ Canto":"Sin canto"}</span>
                                    </label>
                                    <input type="number" min="1" placeholder="Nº placas" value={editForm.cantidadPlacas} onChange={function(e){setEditForm(Object.assign({},editForm,{cantidadPlacas:e.target.value}));}} style={Object.assign({},inp,{textAlign:"center",fontWeight:700})}/>
                                  </div>
                                </div>
                                <div style={{display:"flex",gap:8,marginTop:10}}>
                                  <button onClick={function(){saveEdit(order.id);}} style={{flex:1,background:"#F97316",color:"#fff",border:"none",fontSize:13,fontWeight:600,padding:"8px",borderRadius:8}}>Guardar</button>
                                  <button onClick={function(){setEditing(null);}} style={{fontSize:13,padding:"8px 12px"}}>Cancelar</button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Barra de acciones */}
                          <div style={{borderTop:"1px solid "+stage.bg,padding:"0.5rem 1rem",background:stage.bg,display:"flex",gap:6,alignItems:"center"}}>
                            {mode==="gestion"&&getPrev(order)&&<button onClick={function(){goBack(order.id);}} style={{fontSize:12,padding:"4px 10px",color:"#64748B"}}>← Atrás</button>}
                            {ns
                              ?<HoldButton onAction={function(){advance(order.id);}} color={nsObj&&nsObj.dot} style={{flex:1}}>→ {nsObj&&nsObj.label}</HoldButton>
                              :<div style={{flex:1,fontSize:13,fontWeight:500,color:"#14532D",textAlign:"center"}}>✓ Finalizado</div>
                            }
                            <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,background:payObj.bg,color:payObj.fg,padding:"2px 8px",borderRadius:99,flexShrink:0}}>
                              <Dot color={payObj.dot} size={6}/>{payObj.label}
                            </span>
                            {mode==="gestion"&&(
                              <div style={{display:"flex",gap:4}}>
                                <button onClick={function(e){e.stopPropagation();setEditForm({cliente:order.cliente,observaciones:order.observaciones||"",canto:!!order.canto,cantidadPlacas:order.cantidadPlacas||""});setEditing(order.id);setExpanded(function(ex){return Object.assign({},ex,{[order.id]:false});});}} style={{fontSize:13,padding:"4px 8px",color:"#6366F1"}}>✏️</button>
                                {order.stage==="completado"&&<button onClick={function(){archiveNow(order.id);}} style={{fontSize:12,padding:"4px 8px",color:"#3B82F6"}}>📁</button>}
                                <button onClick={function(){deleteOrder(order.id);}} style={{fontSize:12,padding:"4px 8px",color:"#EF4444"}}>🗑</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
              </div>
            );
          })}
        </div>
      )}

      {/* ══ ESTADÍSTICAS ══ */}
      {view==="resumen"&&(
        <div>
          <div style={{fontSize:15,fontWeight:700,marginBottom:"1rem"}}>📊 Estadísticas de producción</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:"1.25rem"}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:"#64748B",marginBottom:4,textTransform:"uppercase"}}>Período</div>
              <div style={{display:"flex",background:"#F1F5F9",borderRadius:8,padding:3}}>
                {[["hoy","Hoy"],["todo","Todo"]].map(function(item){return <button key={item[0]} onClick={function(){setScope(item[0]);}} style={{flex:1,fontSize:12,fontWeight:600,padding:"6px 0",border:"none",borderRadius:6,background:scope===item[0]?"#fff":"transparent",color:scope===item[0]?"#1E293B":"#64748B",boxShadow:scope===item[0]?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{item[1]}</button>;})}
              </div>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:"#64748B",marginBottom:4,textTransform:"uppercase"}}>Tipo</div>
              <div style={{display:"flex",background:"#F1F5F9",borderRadius:8,padding:3}}>
                {[["todos","Todos"],["canto","Con canto"],["sincanto","Sin canto"]].map(function(item){return <button key={item[0]} onClick={function(){setFilter(item[0]);}} style={{flex:1,fontSize:11,fontWeight:600,padding:"6px 0",border:"none",borderRadius:6,background:filter===item[0]?"#fff":"transparent",color:filter===item[0]?"#1E293B":"#64748B",boxShadow:filter===item[0]?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{item[1]}</button>;})}
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:"1.5rem"}}>
            {[{label:"Completados",value:byFilter.length,color:"#22C55E"},{label:"Con canto",value:wCanto.length,color:"#7C3AED"},{label:"Sin canto",value:woCanto.length,color:"#64748B"}].map(function(k,i){
              return <div key={i} style={{background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,padding:"0.875rem",textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,color:k.color,lineHeight:1}}>{k.value}</div><div style={{fontSize:11,color:"#64748B",marginTop:5}}>{k.label}</div></div>;
            })}
          </div>
          {byFilter.length===0
            ?<div style={{background:"#F8FAFC",borderRadius:12,padding:"2rem",textAlign:"center",color:"#94A3B8",fontSize:13}}>No hay pedidos completados para el período seleccionado.</div>
            :<div>
              <div style={{fontSize:13,fontWeight:700,color:"#1E293B",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>⏱ Tiempos por etapa</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:"1.5rem"}}>
                <StatRow label="Preparación" color="#6366F1" bg="#EEF2FF" values={tPrep}/>
                <StatRow label="Corte" color="#EF4444" bg="#FEE2E2" values={tCorte}/>
                {wCanto.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <StatRow label="Espera Cola Canteo (tiempo muerto)" color="#F97316" bg="#FFF7ED" values={tEsp}/>
                  <StatRow label="Canteo" color="#F59E0B" bg="#FEF3C7" values={tCant}/>
                </div>}
              </div>
              <div style={{fontSize:13,fontWeight:700,color:"#1E293B",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>📦 Tiempo total</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:"1.5rem"}}>
                <StatRow label="Todos" color="#22C55E" bg="#DCFCE7" values={tTot}/>
                {filter==="todos"&&wCanto.length>0&&woCanto.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <StatRow label="Solo con canto" color="#7C3AED" bg="#EDE9FE" values={wCanto.map(function(o){return stageTime(o,"activo","completado");})}/>
                  <StatRow label="Solo sin canto" color="#64748B" bg="#F1F5F9" values={woCanto.map(function(o){return stageTime(o,"activo","completado");})}/>
                </div>}
              </div>
              {todayAll.length>0&&(
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1E293B",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Pedidos de hoy ({todayAll.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {todayAll.map(function(order){
                      var total=stageTime(order,"activo","completado");
                      return <div key={order.id} style={{background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,padding:"0.75rem 1rem",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
                            <span style={{fontWeight:700,fontSize:13}}>{order.numero}</span>
                            <span style={{fontSize:13,color:"#475569"}}>{order.cliente}</span>
                            <span style={{fontSize:10,background:order.canto?"#EDE9FE":"#F1F5F9",color:order.canto?"#4C1D95":"#64748B",padding:"1px 6px",borderRadius:99,fontWeight:700}}>{order.canto?"Con canto":"Sin canto"}</span>
                          </div>
                          <div style={{display:"flex",gap:12,fontSize:11,color:"#94A3B8",flexWrap:"wrap"}}>
                            {stageTime(order,"preparacion","corte")&&<span>Prep: {fmt(stageTime(order,"preparacion","corte"))}</span>}
                            {stageTime(order,"corte",order.canto?"cola_canteo":"completado")&&<span>Corte: {fmt(stageTime(order,"corte",order.canto?"cola_canteo":"completado"))}</span>}
                            {order.canto&&stageTime(order,"cola_canteo","canteo")&&<span>Espera: {fmt(stageTime(order,"cola_canteo","canteo"))}</span>}
                            {order.canto&&stageTime(order,"canteo","completado")&&<span>Canteo: {fmt(stageTime(order,"canteo","completado"))}</span>}
                          </div>
                        </div>
                        {total&&<div style={{fontSize:13,color:"#22C55E",fontWeight:800,flexShrink:0}}>{fmt(total)}</div>}
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </div>
          }
        </div>
      )}

      {/* ══ HISTORIAL ══ */}
      {view==="historial"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <div style={{fontSize:15,fontWeight:700}}>🗂 Historial de pedidos</div>
            {mode==="gestion"&&archivados.length>0&&<button onClick={clearHist} style={{fontSize:12,padding:"5px 12px",color:"#EF4444"}}>🗑 Borrar todo</button>}
          </div>
          {archivados.length===0
            ?<div style={{border:"1px dashed #CBD5E1",borderRadius:10,padding:"2.5rem",textAlign:"center",color:"#94A3B8",fontSize:13}}><div style={{fontSize:28,marginBottom:8}}>🗂</div>Los pedidos completados aparecen acá después de 24h.</div>
            :(function(){
              var todayH=archivados.filter(function(o){return isToday(o.fechaIngreso||o.timestamps&&o.timestamps.activo);});
              var oldH=archivados.filter(function(o){return !isToday(o.fechaIngreso||o.timestamps&&o.timestamps.activo);});
              return <div>
                {todayH.length>0&&<div style={{marginBottom:"1.5rem"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Hoy ({todayH.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>{todayH.map(function(o){return <HistCard key={o.id} order={o}/>;})}</div>
                </div>}
                {oldH.length>0&&<div>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Anteriores ({oldH.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>{oldH.map(function(o){return <HistCard key={o.id} order={o}/>;})}</div>
                </div>}
              </div>;
            })()
          }
        </div>
      )}
    </div>
  );
}

function HistCard(p) {
  var order=p.order;
  var fechaIngreso=order.fechaIngreso||order.timestamps&&order.timestamps.activo;
  var total=order.timestamps&&order.timestamps.completado&&order.timestamps.activo?order.timestamps.completado-order.timestamps.activo:null;
  var payObj=PAYMENT_OPTS.find(function(x){return x.key===(order.payment||"sin_pago");})||PAYMENT_OPTS[0];
  function fmt2(ms){if(!ms||ms<=0)return"—";var t=Math.floor(ms/60000),d=Math.floor(t/1440),h=Math.floor((t%1440)/60),m=t%60;if(d>0)return(d+"d "+(h>0?h+"h ":"")+(m>0?m+"min":"")).trim();if(h>0)return h+"h"+(m>0?" "+m+"min":"");return m+" min";}
  function fmtDate(ts){if(!ts)return"";var d=new Date(ts),dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"],meses=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];return dias[d.getDay()]+" "+d.getDate()+" "+meses[d.getMonth()]+" · "+d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0");}
  return (
    <div style={{background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,padding:"0.75rem 1rem",position:"relative"}}>
      {order.modified&&<div style={{position:"absolute",top:8,right:8,width:9,height:9,borderRadius:"50%",background:"#F97316",border:"2px solid #fff"}}/>}
      <div style={{fontSize:10,fontWeight:600,color:"#fff",background:"#334155",borderRadius:5,padding:"2px 7px",display:"inline-flex",alignItems:"center",gap:4,marginBottom:6}}>
        📅 {fmtDate(fechaIngreso)}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap",paddingRight:order.modified?16:0}}>
        <span style={{fontFamily:"monospace",fontSize:11,color:"#94A3B8"}}>{order.numero}</span>
        <span style={{fontWeight:700,fontSize:13,color:"#1E293B"}}>{order.cliente}</span>
        <span style={{fontSize:10,background:order.canto?"#EDE9FE":"#F1F5F9",color:order.canto?"#4C1D95":"#64748B",padding:"1px 6px",borderRadius:99,fontWeight:700}}>{order.canto?"Con canto":"Sin canto"}</span>
        {order.cantidadPlacas>0&&<span style={{fontSize:10,background:"#EFF6FF",color:"#1D4ED8",padding:"1px 6px",borderRadius:99,fontWeight:700}}>{order.cantidadPlacas} placas</span>}
        <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,fontWeight:700,background:payObj.bg,color:payObj.fg,padding:"1px 7px",borderRadius:99}}>{payObj.label}</span>
        {total&&<span style={{fontSize:11,background:"#DCFCE7",color:"#14532D",padding:"1px 7px",borderRadius:99,fontWeight:700,marginLeft:"auto"}}>{fmt2(total)} total</span>}
      </div>
      {order.observaciones&&<div style={{fontSize:12,color:"#64748B",whiteSpace:"pre-wrap",lineHeight:1.5}}>{order.observaciones}</div>}
    </div>
  );
}
 
