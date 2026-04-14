import React, { useState, useEffect, useMemo, useRef } from "react";
import { Undo, Save, Calendar, Database, Upload, RefreshCw, BarChart2, X, Trash2 } from "lucide-react";

/**
 * 弓道「矢所ログ」V7.0 (Unified Core - Final Build)
 * - エラーを解消し、保存・削除・読込ロジックを完全復元。
 * - V5.3のピボットズーム ＋ V5.4の堅牢なビューポート管理。
 * - 制限のない自由移動 ＋ iOSライクな慣性スクロール。
 * - ダブルタップで原点復帰（迷子防止機能）。
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
  const avgX = shots.reduce((acc, s) => acc + s.x, 0) / shots.length;
  const avgY = shots.reduce((acc, s) => acc + s.y, 0) / shots.length;
  const hitRate = (shots.filter(s => s.zone === "的な").length / shots.length) * 100;
  let report = `【AI矢所分析】\n\n`;
  if (avgX > 15) report += `・「右逸」傾向。妻手の緩みに注意。\n\n`;
  else if (avgX < -15) report += `・「前矢」傾向。押し手・物見を確認。\n\n`;
  else report += `・左右の筋は安定しています。\n\n`;
  if (avgY < ANDUCHI_H/3 - 15) report += `・矢所が高い。狙いを確認。\n\n`;
  else if (avgY > ANDUCHI_H/3 + 15) report += `・「下矢」傾向。肩の上がりを確認。\n\n`;
  else report += `・上下の高さが揃っています。\n\n`;
  report += `【総評】的中率 ${hitRate.toFixed(1)}%。`;
  return report;
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
  const velocityRef = useRef({ x: 0, y: 0 });
  const requestRef = useRef<number>();
  const lastTapRef = useRef<number>(0);
  const hasMovedRef = useRef(false);
  const isMultiTouchRef = useRef(false);

  // iPadパッチ：ブラウザの干渉を防止
  useEffect(() => {
    const preventDefault = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener("touchmove", preventDefault, { passive: false });
    return () => document.removeEventListener("touchmove", preventDefault);
  }, []);

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

  // --- 復元したロジック ---
  const saveRecord = () => {
    const newId = editingId || Date.now();
    const newH = editingId 
      ? history.map(h => h.id === editingId ? { ...h, date, place, note, shots } : h) 
      : [{ id: newId, date, place, note, shots }, ...history];
    const sortedH = [...newH].sort((a, b) => b.date.localeCompare(a.date));
    setHistory(sortedH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortedH));
    setEditingId(newId);
    alert("保存完了");
  };

  const deleteRecord = () => {
    if (!editingId || !confirm("この記録を削除しますか？")) return;
    const newH = history.filter(h => h.id !== editingId);
    setHistory(newH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newH));
    resetUI();
    alert("削除完了");
  };

  const loadHistory = (h: HistoryRecord) => {
    setIsRangeMode(false); 
    setEditingId(h.id); 
    setDate(h.date); 
    setPlace(h.place); 
    setNote(h.note); 
    setShots(h.shots); 
    setZoom(1); 
    setOffset({ x: 0, y: 0 });
  };
  // ----------------------

  const handleTouchStart = (e: React.TouchEvent) => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    const now = Date.now();
    if (now - lastTapRef.current < 300 && e.touches.length === 1) {
      setZoom(1); setOffset({ x: 0, y: 0 }); return;
    }
    lastTapRef.current = now;

    hasMovedRef.current = false;
    isMultiTouchRef.current = e.touches.length > 1;
    if (e.touches.length === 2) {
      touchDistRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    velocityRef.current = { x: 0, y: 0 };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.closest('.history-scroll')) return;

    if (e.touches.length === 2 && touchDistRef.current !== null) {
      hasMovedRef.current = true;
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const delta = dist / touchDistRef.current;
      const nextZoom = Math.min(Math.max(zoom * delta, 0.8), 5);
      
      setOffset(prev => ({
        x: centerX - (centerX - prev.x) * (nextZoom / zoom),
        y: centerY - (centerY - prev.y) * (nextZoom / zoom)
      }));
      setZoom(nextZoom);
      touchDistRef.current = dist;
    } else if (e.touches.length === 1) {
      hasMovedRef.current = true;
      const dx = e.touches[0].clientX - lastTouchRef.current.x;
      const dy = e.touches[0].clientY - lastTouchRef.current.y;
      velocityRef.current = { x: dx, y: dy };
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    }
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const animateGlide = () => {
    velocityRef.current.x *= 0.95;
    velocityRef.current.y *= 0.95;
    setOffset(prev => {
      if (Math.abs(velocityRef.current.x) < 0.1 && Math.abs(velocityRef.current.y) < 0.1) return prev;
      requestRef.current = requestAnimationFrame(animateGlide);
      return { x: prev.x + velocityRef.current.x, y: prev.y + velocityRef.current.y };
    });
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMultiTouchRef.current && !hasMovedRef.current) {
      handleInteraction(e);
    } else if (hasMovedRef.current && zoom > 1.0) {
      requestRef.current = requestAnimationFrame(animateGlide);
    }
    if (zoom < 1.05) { setZoom(1); setOffset({ x: 0, y: 0 }); }
  };

  const handleInteraction = (e: any) => {
    if (isRangeMode || !svgRef.current || hasMovedRef.current || isMultiTouchRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    const x = (clientX - rect.left - rect.width / 2) * ((ANDUCHI_W + 100) / rect.width);
    const y = (clientY - rect.top - rect.height / 2) * ((ANDUCHI_H + STAIRS_H + 100) / rect.height);
    const zone = Math.sqrt(x*x + (y - ANDUCHI_H/3)**2) <= R ? "的な" : (y < ANDUCHI_H/2 ? "安土" : "階段");
    setShots([...shots, { id: Date.now(), x, y, zone, comment: "" }]);
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 font-sans overflow-hidden touch-none"
         onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      
      <header className="bg-black text-white px-6 py-4 flex justify-between items-center z-50 shadow-2xl">
        <div className="font-black text-xl italic uppercase tracking-tighter">弓道 矢所ログ</div>
        <div className="flex gap-2">
          {!isRangeMode ? (
            <>
              {editingId && <button onClick={deleteRecord} className="bg-red-900/50 px-3 py-1.5 rounded-lg text-xs font-black border border-red-800 text-white"><Trash2 size={14}/></button>}
              <button onClick={resetUI} className="bg-gray-800 px-3 py-1.5 rounded-lg text-xs font-bold text-white">新規</button>
              <button onClick={saveRecord} className="bg-emerald-700 px-4 py-1.5 rounded-lg text-sm font-black flex items-center gap-2 text-white"><Save size={16}/>保存</button>
            </>
          ) : (
            <button onClick={() => setIsRangeMode(false)} className="bg-red-700 px-4 py-1.5 rounded-lg text-sm font-black flex items-center gap-2 text-white"><X size={16}/>終了</button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-gray-50 history-scroll">
        <div 
          className="origin-top-left will-change-transform"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
        >
          <div className="p-4 md:p-8 pb-40">
            <main className="max-w-[1200px] mx-auto grid lg:grid-cols-[1fr,380px] gap-6">
              <div className="space-y-6">
                <section className="bg-white p-6 rounded-3xl border shadow-sm flex gap-6">
                  <div className="flex-1"><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="bg-transparent text-xl font-black outline-none w-full" /></div>
                  <div className="flex-[1.5]"><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase">Place</label><input type="text" value={place} onChange={e=>setPlace(e.target.value)} className="bg-transparent text-xl font-black outline-none w-full border-b-2 border-gray-100 focus:border-black transition-colors" placeholder="稽古場所" /></div>
                </section>

                <div className="relative rounded-[2.5rem] border-[6px] border-white overflow-hidden bg-gray-200 shadow-2xl aspect-[4/3] lg:aspect-auto">
                  <svg ref={svgRef} viewBox={`-${(ANDUCHI_W+100)/2} -${(ANDUCHI_H+STAIRS_H+100)/2} ${ANDUCHI_W+100} ${ANDUCHI_H+STAIRS_H+100}`} className="w-full h-full cursor-crosshair">
                    <rect x={-ANDUCHI_W/2} y={-ANDUCHI_H/2} width={ANDUCHI_W} height={ANDUCHI_H} fill="#d2b48c" />
                    <rect x={-ANDUCHI_W/2} y={ANDUCHI_H/2} width={ANDUCHI_W} height={STAIRS_H} fill="#4a634a" />
                    {[-TARGET_SPACING, 0, TARGET_SPACING].map(ox => (
                      <g key={ox} transform={`translate(${ox}, ${ANDUCHI_H/3})`}>
                        {[5,4,3,2,1].map(i => (<circle key={i} r={(R/5)*i} fill={i%2===0 ? "white" : "black"} stroke="#333" strokeWidth="0.5" />))}
                      </g>
                    ))}
                    {(isRangeMode ? stats.all : shots).map((s, idx) => (
                      <g key={s.id} transform={`translate(${s.x}, ${s.y})`}>
                        <circle r={isRangeMode ? 8 : 14} fill={isRangeMode ? "rgba(0,0,0,0.4)" : "white"} stroke={s.zone==="的な"?"#ef4444":"#374151"} strokeWidth={2.5} />
                        {!isRangeMode && <text fontSize={11} textAnchor="middle" dominantBaseline="central" fontWeight="900" fill={s.zone==="的な"?"#ef4444":"#374151"}>{idx+1}</text>}
                      </g>
                    ))}
                  </svg>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 italic">Zoom: {zoom.toFixed(2)}x</span>
                  <div className="flex gap-3">
                    <button onClick={() => { setZoom(1); setOffset({x:0, y:0}); }} className="px-4 py-2 bg-white border rounded-xl text-xs font-bold shadow-sm active:bg-gray-100">Reset</button>
                    <button onClick={()=>setShots(shots.slice(0,-1))} className="bg-black text-white px-8 py-2 rounded-xl font-black shadow-lg flex items-center gap-2 active:scale-95 text-white" disabled={isRangeMode}><Undo size={18}/>1手戻す</button>
                  </div>
                </div>
              </div>

              <aside className="space-y-6">
                <div className="bg-white border rounded-[2rem] p-6 h-[450px] overflow-y-auto shadow-sm history-scroll">
                  <h3 className="text-xs font-black text-gray-400 uppercase mb-4 flex justify-between tracking-widest"><span>{isRangeMode ? 'AI Analysis' : 'Shots Log'}</span></h3>
                  {!isRangeMode ? shots.map((s, i) => (
                    <div key={s.id} className="flex gap-3 mb-3 border-b border-gray-50 pb-3 items-center">
                      <div className="w-6 h-6 bg-black text-white rounded-full flex items-center justify-center font-bold text-[9px]">{i+1}</div>
                      <div className={`text-[10px] font-black w-8 ${s.zone==="的な"?"text-red-600":"text-gray-400"}`}>{s.zone==="的な"?"的中":"安土"}</div>
                      <input value={s.comment} onChange={e=>{const n=[...shots]; n[i].comment=e.target.value; setShots(n);}} className="flex-1 text-sm font-medium outline-none border-l pl-2 text-slate-900" placeholder="..." />
                    </div>
                  )) : (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium text-gray-700">{getAIAnalysis(stats.all)}</div>
                  )}
                </div>
                <textarea value={note} onChange={e=>setNote(e.target.value)} className="w-full bg-white border rounded-[2rem] p-6 h-32 outline-none text-sm shadow-sm text-slate-800 font-bold" placeholder="全体メモ・気づき..." />
              </aside>
            </main>

            <section className="mt-20 max-w-[1200px] mx-auto border-t pt-10 px-4">
              <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.4em] mb-8 text-center">History Archive</h2>
              <div className="bg-white p-4 rounded-3xl border shadow-sm flex items-center justify-center gap-4 mb-10 max-w-lg mx-auto">
                 <Calendar size={14} className="text-gray-400"/><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none" />
                 <span className="text-gray-300">~</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none" />
                 <button onClick={() => setIsRangeMode(true)} className="bg-black text-white px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 text-white"><BarChart2 size={14}/>分析</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="p-6 rounded-3xl bg-white border shadow-sm text-center"><span className="text-[10px] font-black text-gray-400 block mb-1">Total</span><span className="text-4xl font-black text-slate-800">{stats.total}</span></div>
                <div className="p-6 rounded-3xl bg-white border shadow-sm text-center"><span className="text-[10px] font-black text-emerald-500 block mb-1">Hits</span><span className="text-4xl font-black text-emerald-600">{stats.hits}</span></div>
                <div className="p-6 rounded-3xl bg-white border shadow-sm text-center"><span className="text-[10px] font-black text-blue-500 block mb-1">Rate</span><span className="text-4xl font-black text-blue-700">{stats.rate}%</span></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.filtered.map(h => (
                  <button key={h.id} onClick={()=>loadHistory(h)} className={`p-5 rounded-[1.8rem] border-2 text-left transition-all ${editingId===h.id ? "bg-black text-white border-black" : "bg-white border-gray-100 active:bg-gray-50 shadow-sm"}`}>
                    <div className="text-[10px] font-mono opacity-50 mb-1">{h.date}</div><div className="font-black truncate text-sm uppercase">{h.place || "Practice"}</div>
                    <div className="mt-3 text-[9px] border-t pt-2 flex justify-between font-bold"><span>{h.shots.length} Shots</span><span className="text-emerald-500">Hits {h.shots.filter(s=>s.zone==="的な").length}</span></div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="bg-black/95 text-white p-4 flex justify-around items-center border-t border-gray-800 backdrop-blur-xl">
        <div className="flex items-center gap-2 opacity-50"><div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div><span className="text-[9px] font-mono uppercase tracking-tighter text-white">V7.0 Unified Core</span></div>
        <div className="flex gap-2">
          <button onClick={() => importFileRef.current?.click()} className="bg-gray-800 p-2 rounded-lg text-white"><Upload size={14}/></button>
          <button onClick={()=>{const d=localStorage.getItem(STORAGE_KEY); if(!d) return; const b=new Blob([d],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=`backup.json`; a.click();}} className="bg-blue-700 p-2 rounded-lg shadow-lg text-white"><Database size={14}/></button>
          <button onClick={() => { if(confirm("【警告】全データを消去しますか？")) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }} className="bg-red-900/40 p-2 rounded-lg border border-red-800 text-[10px] font-bold text-white">全消去</button>
          <button onClick={()=>window.location.reload()} className="bg-gray-900 p-2 rounded-lg border border-gray-800 text-white"><RefreshCw size={14}/></button>
        </div>
        <input ref={importFileRef} type="file" accept=".json" onChange={e => {
          const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ try { const i=JSON.parse(ev.target?.result as string); if(confirm("データを統合しますか？")){ const c=[...i,...history]; const u=Array.from(new Map(c.map(t=>[t.id,t])).values()); setHistory(u.sort((a:any,b:any)=>b.date.localeCompare(a.date))); localStorage.setItem(STORAGE_KEY,JSON.stringify(u)); } } catch(err){alert("Error");} }; r.readAsText(f);
        }} className="hidden" />
      </footer>
    </div>
  );
};

export default App;
