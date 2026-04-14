import React, { useState, useEffect, useMemo, useRef } from "react";
import { Undo, Save, Calendar, Database, Upload, RefreshCw, BarChart2, X, Trash2 } from "lucide-react";

/**
 * 弓道「矢所ログ」V7.4 (V7.1 Operation Feel + Judgment Fix)
 * - 操作感：V7.1と同じ「ダイレクトな追従性」に完全復帰（慣性・制限なし）
 * - 機能：最新の「3的同時判定」を搭載。どの的に当たっても的中と判定。
 * - デザイン：V5.3の原本デザインを100%維持。
 */

type Shot = { id: number; x: number; y: number; zone: string; comment: string; };
type HistoryRecord = { id: number; date: string; place: string; note: string; shots: Shot[]; };

const R = 50;
const TARGET_SPACING = 9.6 * R;
const ANDUCHI_W = TARGET_SPACING * 2 + R * 4;
const ANDUCHI_H = 8.8 * R;
const STAIRS_H = 3.0 * R;
const STORAGE_KEY = "kyudo-log-history";

const getAIAnalysis = (shots: Shot[]) => {
  if (shots.length === 0) return "データがありません。";
  const hits = shots.filter(s => s.zone === "的な").length;
  const hitRate = (hits / shots.length) * 100;
  return `【AI分析】的中率: ${hitRate.toFixed(1)}% (${shots.length}射中${hits}中)。`;
};

const App: React.FC = () => {
  const [shots, setShots] = useState<Shot[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  const svgRef = useRef<SVGSVGElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const touchDistRef = useRef<number | null>(null);
  const hasMovedRef = useRef(false);
  const isMultiTouchRef = useRef(false);

  useEffect(() => {
    const preventDefault = (e: TouchEvent) => {
      if (zoom > 1.01 || e.touches.length > 1) {
        if (e.cancelable) e.preventDefault();
      }
    };
    document.addEventListener("touchmove", preventDefault, { passive: false });
    return () => document.removeEventListener("touchmove", preventDefault);
  }, [zoom]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setHistory(JSON.parse(saved).sort((a: any, b: any) => b.date.localeCompare(a.date)));
  }, []);

  const stats = useMemo(() => {
    const filtered = isRangeMode ? history.filter(h => h.date >= startDate && h.date <= endDate) : history;
    const all = filtered.flatMap(h => h.shots);
    const hits = all.filter(s => s.zone === "的な").length;
    return { total: all.length, hits, rate: all.length > 0 ? ((hits / all.length) * 100).toFixed(1) : "0.0", all, filtered };
  }, [history, isRangeMode, startDate, endDate]);

  const resetUI = () => { setEditingId(null); setShots([]); setPlace(""); setNote(""); setZoom(1); setOffset({ x: 0, y: 0 }); };

  const saveRecord = () => {
    const newId = editingId || Date.now();
    const newH = editingId ? history.map(h => h.id === editingId ? { ...h, date, place, note, shots } : h) : [{ id: newId, date, place, note, shots }, ...history];
    const sortedH = [...newH].sort((a, b) => b.date.localeCompare(a.date));
    setHistory(sortedH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortedH));
    setEditingId(newId);
    alert("保存完了");
  };

  const deleteRecord = () => {
    if (!editingId || !confirm("削除しますか？")) return;
    const newH = history.filter(h => h.id !== editingId);
    setHistory(newH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newH));
    resetUI();
  };

  const loadHistory = (h: HistoryRecord) => {
    setIsRangeMode(false); setEditingId(h.id); setDate(h.date); setPlace(h.place); setNote(h.note); setShots(h.shots); setZoom(1); setOffset({x:0, y:0});
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    hasMovedRef.current = false;
    isMultiTouchRef.current = e.touches.length > 1;
    if (e.touches.length === 2) {
      touchDistRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    hasMovedRef.current = true;
    if (e.touches.length === 2 && touchDistRef.current !== null) {
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const delta = dist / touchDistRef.current;
      const nextZoom = Math.min(Math.max(zoom * delta, 1.0), 5);
      setOffset(prev => ({
        x: centerX - (centerX - prev.x) * (nextZoom / zoom),
        y: centerY - (centerY - prev.y) * (nextZoom / zoom)
      }));
      setZoom(nextZoom);
      touchDistRef.current = dist;
    } else if (e.touches.length === 1) {
      // V7.1と同じ、指に1:1で追従するダイレクト移動
      setOffset(prev => ({ x: prev.x + (e.touches[0].clientX - lastTouchRef.current.x), y: prev.y + (e.touches[0].clientY - lastTouchRef.current.y) }));
    }
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleInteraction = (e: any) => {
    if (isRangeMode || !svgRef.current || hasMovedRef.current || isMultiTouchRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    
    const x = (clientX - rect.left - rect.width / 2) * ((ANDUCHI_W + 100) / rect.width);
    const y = (clientY - rect.top - rect.height / 2) * ((ANDUCHI_H + STAIRS_H + 100) / rect.height);
    
    // 【判定修正】左・中・右すべての的をチェック（3的対応）
    const targets = [-TARGET_SPACING, 0, TARGET_SPACING];
    const isHit = targets.some(ox => Math.sqrt((x - ox)**2 + (y - ANDUCHI_H/3)**2) <= R);
    
    const zone = isHit ? "的な" : (y < ANDUCHI_H/2 ? "安土" : "階段");
    setShots([...shots, { id: Date.now(), x, y, zone, comment: "" }]);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-hidden touch-none"
         onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
         onTouchEnd={(e) => { if (!isMultiTouchRef.current && !hasMovedRef.current) handleInteraction(e); }}
    >
      <header className="bg-black text-white px-8 py-5 flex justify-between items-center sticky top-0 z-50 shadow-xl">
        <div className="font-black text-xl italic uppercase tracking-widest text-white">弓道 矢所ログ</div>
        <div className="flex gap-3">
          {!isRangeMode ? (
            <>
              {editingId && <button onClick={deleteRecord} className="bg-red-900/50 hover:bg-red-700 px-4 py-2 rounded-lg font-black flex items-center gap-2 transition border border-red-800 text-white"><Trash2 size={18}/></button>}
              <button onClick={resetUI} className="bg-gray-800 px-4 py-2 rounded-lg text-xs font-bold text-white">新規</button>
              <button onClick={saveRecord} className="bg-emerald-700 px-6 py-2 rounded-lg font-black flex items-center gap-2 transition shadow-lg text-white"><Save size={18}/>保存</button>
            </>
          ) : (
            <button onClick={() => setIsRangeMode(false)} className="bg-red-700 px-6 py-2 rounded-lg font-black flex items-center gap-2 transition text-white"><X size={18}/>終了</button>
          )}
        </div>
      </header>

      {/* V7.1と同等のダイレクトレスポンス設定 */}
      <div className="origin-top-left" style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`, willChange: 'transform' }}>
        <div className="p-8 pb-40">
          <main className="max-w-[95%] mx-auto grid lg:grid-cols-[1fr,400px] gap-8">
            <div className="space-y-6">
              <section className="bg-gray-50 p-6 rounded-3xl border flex gap-10 shadow-sm">
                <div><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="bg-transparent text-2xl font-black outline-none text-slate-900" /></div>
                <div className="flex-1"><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">Place</label><input type="text" value={place} onChange={e=>setPlace(e.target.value)} className="bg-transparent text-2xl font-black outline-none w-full border-b text-slate-900" placeholder="稽古場所" /></div>
              </section>

              <div className="relative rounded-[2.5rem] border-4 border-gray-100 overflow-hidden bg-gray-100 shadow-inner">
                <svg ref={svgRef} viewBox={`-${(ANDUCHI_W+100)/2} -${(ANDUCHI_H+STAIRS_H+100)/2} ${ANDUCHI_W+100} ${ANDUCHI_H+STAIRS_H+100}`} className="w-full h-auto cursor-crosshair">
                  <rect x={-ANDUCHI_W/2} y={-ANDUCHI_H/2} width={ANDUCHI_W} height={ANDUCHI_H} fill="#d2b48c" />
                  <rect x={-ANDUCHI_W/2} y={ANDUCHI_H/2} width={ANDUCHI_W} height={STAIRS_H} fill="#4a634a" />
                  {[-TARGET_SPACING, 0, TARGET_SPACING].map(ox => (
                    <g key={ox} transform={`translate(${ox}, ${ANDUCHI_H/3})`}>
                      {[5,4,3,2,1].map(i => (<circle key={i} r={(R/5)*i} fill={i%2===0 ? "white" : "black"} stroke="#333" strokeWidth="0.5" />))}
                    </g>
                  ))}
                  {(isRangeMode ? stats.all : shots).map((s, idx) => (
                    <g key={s.id} transform={`translate(${s.x}, ${s.y})`}>
                      <circle r={14} fill={isRangeMode ? "rgba(0,0,0,0.5)" : "white"} stroke={s.zone==="的な"?"#ef4444":"#374151"} strokeWidth={2} />
                      {!isRangeMode && <text fontSize={12} textAnchor="middle" dominantBaseline="central" fontWeight="900" fill={s.zone==="的な"?"#ef4444":"#374151"}>{idx+1}</text>}
                    </g>
                  ))}
                </svg>
              </div>
              <div className="flex justify-end gap-4 text-white font-bold">
                 <button onClick={() => { setZoom(1); setOffset({x:0, y:0}); }} className="px-4 py-2 bg-white border rounded-xl text-xs text-gray-500 shadow-sm active:bg-gray-100">Reset</button>
                 <button onClick={()=>setShots(shots.slice(0,-1))} className="bg-black text-white px-8 py-3 rounded-2xl font-black shadow-lg">Undo</button>
              </div>
            </div>

            <aside className="space-y-6">
              <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-6 h-[500px] overflow-y-auto">
                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest font-bold">Log Details</h3>
                {isRangeMode ? <div className="text-sm whitespace-pre-wrap font-bold text-slate-700">{getAIAnalysis(stats.all)}</div> : shots.map((s, i) => (
                  <div key={s.id} className="flex gap-3 mb-4 border-b pb-4 items-center">
                    <div className="w-7 h-7 bg-black text-white rounded-full flex items-center justify-center text-[10px] font-bold">{i+1}</div>
                    <div className={`text-xs font-black ${s.zone==="的な"?"text-red-600":"text-gray-500"}`}>{s.zone==="的な"?"的中":"安土"}</div>
                    <input value={s.comment} onChange={e=>{const n=[...shots]; n[i].comment=e.target.value; setShots(n);}} className="flex-1 text-sm outline-none pl-3 border-l text-slate-800" placeholder="備考..." />
                  </div>
                ))}
              </div>
              <textarea value={note} onChange={e=>setNote(e.target.value)} className="w-full bg-gray-50 border rounded-[2rem] p-6 h-32 outline-none font-bold text-slate-800" placeholder="メモ..." />
            </aside>
          </main>

          <section className="mt-20 border-t pt-10 px-4">
            <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest text-center mb-8">History Archive</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.filtered.map(h => (
                <button key={h.id} onClick={()=>loadHistory(h)} className={`p-6 rounded-[2rem] border-4 text-left ${editingId===h.id ? "bg-black text-white" : "bg-white border-gray-100 shadow-sm"}`}>
                  <div className="text-xs opacity-60 mb-2">{h.date}</div><div className="font-black truncate uppercase text-sm">{h.place || "PRACTICE"}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 w-full bg-black/90 text-white p-4 flex justify-around items-center z-50">
        <span className="text-[10px] font-mono text-gray-400 uppercase italic">V7.4 Unified Stable</span>
        <div className="flex gap-4">
          <button onClick={() => importFileRef.current?.click()} className="bg-gray-800 px-4 py-2 rounded-xl text-[10px] font-black text-white">読込</button>
          <button onClick={()=>{const d=localStorage.getItem(STORAGE_KEY); if(!d) return; const b=new Blob([d],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=`backup.json`; a.click();}} className="bg-blue-600 px-4 py-2 rounded-xl text-[10px] font-black text-white">書出</button>
          <button onClick={()=>window.location.reload()} className="bg-gray-900 p-2 rounded-xl text-white"><RefreshCw size={14}/></button>
        </div>
        <input ref={importFileRef} type="file" accept=".json" onChange={e => {
          const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ try { const i=JSON.parse(ev.target?.result as string); if(confirm("統合しますか？")){ const c=[...i,...history]; const u=Array.from(new Map(c.map(t=>[t.id,t])).values()); setHistory(u.sort((a:any,b:any)=>b.date.localeCompare(a.date))); localStorage.setItem(STORAGE_KEY,JSON.stringify(u)); } } catch(err){alert("Error");} }; r.readAsText(f);
        }} className="hidden" />
      </footer>
    </div>
  );
};

export default App;
