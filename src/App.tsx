import React, { useState, useEffect, useMemo, useRef } from "react";
import { Undo, Save, Calendar, Database, Upload, RefreshCw, BarChart2, X, Trash2 } from "lucide-react";

/**
 * 弓道「矢所ログ」V7.8 (Functional Restore + Center Hit Only)
 * - 的中判定：中央の的（x=0）のみを「的中」とするロジックに修正
 * - 機能復元：期間分析、統計カード、AIレポート、履歴をすべて原本より復旧
 * - 操作感：V7.1のダイレクト・レスポンス（遅延なし）を維持
 */

type Shot = { id: number; x: number; y: number; zone: string; comment: string; };
type HistoryRecord = { id: number; date: string; place: string; note: string; shots: Shot[]; };

const R = 50;
const TARGET_SPACING = 9.6 * R;
const ANDUCHI_W = TARGET_SPACING * 2 + R * 4;
const ANDUCHI_H = 8.8 * R;
const STAIRS_H = 3.0 * R;
const STORAGE_KEY = "kyudo-log-history";
const PAN_SENSITIVITY = 1.0; 

const getAIAnalysis = (shots: Shot[]) => {
  if (shots.length === 0) return "データがありません。";
  const avgX = shots.reduce((acc, s) => acc + s.x, 0) / shots.length;
  const avgY = shots.reduce((acc, s) => acc + s.y, 0) / shots.length;
  const hits = shots.filter(s => s.zone === "的な").length;
  const hitRate = (hits / shots.length) * 100;
  
  let report = `【AI矢所分析】\n\n`;
  if (avgX > 15) report += `・「右逸」傾向。妻手の緩みに注意。\n\n`;
  else if (avgX < -15) report += `・「前矢」傾向。押し手・物見を確認。\n\n`;
  else report += `・左右の筋は安定しています。\n\n`;
  
  if (avgY < ANDUCHI_H/3 - 15) report += `・矢所が高い。狙いを確認。\n\n`;
  else if (avgY > ANDUCHI_H/3 + 15) report += `・「下矢」傾向。肩の上がりを確認。\n\n`;
  else report += `・上下の高さが揃っています。\n\n`;
  
  report += `【総評】的中率 ${hitRate.toFixed(1)}% (${shots.length}射中${hits}中)。`;
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
  
  const touchDistRef = useRef<number | null>(null);
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const isMultiTouchRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setHistory(JSON.parse(saved).sort((a: any, b: any) => b.date.localeCompare(a.date)));
  }, []);

  const filteredHistory = useMemo(() => isRangeMode ? history.filter(h => h.date >= startDate && h.date <= endDate) : history, [history, isRangeMode, startDate, endDate]);

  const stats = useMemo(() => {
    const all = filteredHistory.flatMap(h => h.shots);
    const hits = all.filter(s => s.zone === "的な").length;
    return { total: all.length, hits, rate: all.length > 0 ? ((hits / all.length) * 100).toFixed(1) : "0.0", all };
  }, [filteredHistory]);

  const resetUI = () => { setEditingId(null); setShots([]); setPlace(""); setNote(""); setZoom(1); setOffset({ x: 0, y: 0 }); };

  const saveRecord = () => {
    const newId = editingId || Date.now();
    const newH = editingId ? history.map(h => h.id === editingId ? { ...h, date, place, note, shots } : h) : [{ id: newId, date, place, note, shots }, ...history];
    const sorted = [...newH].sort((a, b) => b.date.localeCompare(a.date));
    setHistory(sorted);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    setEditingId(newId);
    alert("保存完了");
  };

  const loadHistory = (h: HistoryRecord) => {
    setIsRangeMode(false); setEditingId(h.id); setDate(h.date); setPlace(h.place); setNote(h.note); setShots(h.shots); setZoom(1); setOffset({x:0, y:0});
  };

  const deleteRecord = () => {
    if (!editingId || !confirm("この記録を削除しますか？")) return;
    const newH = history.filter(h => h.id !== editingId);
    setHistory(newH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newH));
    resetUI();
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
      if (nextZoom !== zoom) {
        setOffset(prev => ({
          x: centerX - (centerX - prev.x) * (nextZoom / zoom),
          y: centerY - (centerY - prev.y) * (nextZoom / zoom)
        }));
        setZoom(nextZoom);
      }
      touchDistRef.current = dist;
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      setOffset(prev => ({ x: prev.x + (touch.clientX - lastTouchRef.current.x), y: prev.y + (touch.clientY - lastTouchRef.current.y) }));
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
    
    // 【判定修正】真ん中の的（x=0, y=ANDUCHI_H/3）のみを的中とする
    const isHit = Math.sqrt(x*x + (y - ANDUCHI_H/3)**2) <= R;
    
    const zone = isHit ? "的な" : (y < ANDUCHI_H/2 ? "安土" : "階段");
    setShots([...shots, { id: Date.now(), x, y, zone, comment: "" }]);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans overflow-hidden touch-none"
         style={{ touchAction: 'none' }}
         onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
         onTouchEnd={(e) => { if (!isMultiTouchRef.current && !hasMovedRef.current) handleInteraction(e); }}
    >
      <header className="bg-black text-white px-8 py-5 flex justify-between items-center sticky top-0 z-50 shadow-xl">
        <div className="font-black text-xl italic uppercase tracking-widest text-white">弓道 矢所ログ</div>
        <div className="flex gap-3 text-white">
          {!isRangeMode ? (
            <>
              {editingId && <button onClick={deleteRecord} className="bg-red-900/50 hover:bg-red-700 px-4 py-2 rounded-lg font-black flex items-center gap-2 transition border border-red-800"><Trash2 size={18}/></button>}
              <button onClick={resetUI} className="bg-gray-800 px-4 py-2 rounded-lg text-xs font-bold">新規</button>
              <button onClick={saveRecord} className="bg-emerald-700 px-6 py-2 rounded-lg font-black flex items-center gap-2 transition shadow-lg"><Save size={18}/>保存</button>
            </>
          ) : (
            <button onClick={() => setIsRangeMode(false)} className="bg-red-700 px-6 py-2 rounded-lg font-black flex items-center gap-2 transition"><X size={18}/>終了</button>
          )}
        </div>
      </header>

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
              <div className="flex justify-end items-center gap-4 text-white">
                <button onClick={() => { setZoom(1); setOffset({x:0, y:0}); }} className="px-4 py-2 bg-white border rounded-xl text-xs text-slate-500 font-bold">リセット</button>
                <button onClick={()=>setShots(shots.slice(0,-1))} className="bg-black text-white px-8 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg transition active:scale-95 text-white" disabled={isRangeMode}><Undo size={20}/>戻す</button>
              </div>
            </div>

            <aside className="space-y-6">
              <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-6 h-[500px] overflow-y-auto shadow-sm">
                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 flex justify-between tracking-widest font-bold text-slate-400"><span>{isRangeMode ? 'AI分析結果' : 'Shots Note'}</span><span>{isRangeMode ? '' : '判定 | 備考'}</span></h3>
                {!isRangeMode ? shots.map((s, i) => (
                  <div key={s.id} className="flex gap-3 mb-4 border-b border-gray-50 pb-4 items-center">
                    <div className="w-7 h-7 bg-black text-white rounded-full flex items-center justify-center font-bold text-[10px] shrink-0">{i+1}</div>
                    <div className={`text-xs font-black shrink-0 w-10 ${s.zone==="的な"?"text-red-600":"text-gray-500"}`}>{s.zone==="的な"?"的中":"安土"}</div>
                    <input value={s.comment} onChange={e=>{const n=[...shots]; n[i].comment=e.target.value; setShots(n);}} className="flex-1 outline-none text-sm border-l pl-3 font-medium text-slate-900" placeholder="備考..." />
                  </div>
                )) : (
                  <div className="bg-gray-50 p-5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap font-medium text-gray-700 border border-gray-200">{getAIAnalysis(stats.all)}</div>
                )}
              </div>
              <textarea value={note} onChange={e=>setNote(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-[2rem] p-6 h-32 outline-none text-sm resize-none shadow-inner text-slate-900 font-bold" placeholder="全体まとめ..." />
            </aside>
          </main>

          {/* 復元：履歴統計・期間分析エリア */}
          <section className="mt-20 border-t pt-10 px-4">
            <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest italic tracking-[0.3em] mb-8 text-center text-slate-400">History Archive</h2>
            <div className="bg-gray-100 p-4 rounded-3xl flex items-center justify-center gap-4 border shadow-inner mb-8 max-w-2xl mx-auto">
               <Calendar size={14} className="text-gray-400"/><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none text-slate-900" />
               <span className="text-gray-300">〜</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none text-slate-900" />
               <button onClick={() => setIsRangeMode(true)} className="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition hover:bg-gray-800 shadow-md text-white"><BarChart2 size={14}/>期間分析</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="p-6 rounded-3xl border text-center bg-gray-50 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 italic">Total</span><span className="text-4xl font-black text-slate-800">{stats.total}</span></div>
              <div className="p-6 rounded-3xl border text-center bg-emerald-50 border-emerald-100 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 text-emerald-600 italic">Hits</span><span className="text-4xl font-black text-emerald-600">{stats.hits}</span></div>
              <div className="p-6 rounded-3xl border text-center bg-blue-50 border-blue-100 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 text-blue-700 italic">Rate</span><span className="text-4xl font-black text-blue-700">{stats.rate}%</span></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {filteredHistory.map(h => (
                <button key={h.id} onClick={()=>loadHistory(h)} className={`p-6 rounded-[2rem] border-4 text-left transition-all ${editingId===h.id ? "bg-black text-white border-black shadow-2xl scale-105" : "bg-white border-gray-100 hover:border-gray-200 shadow-sm text-slate-900"}`}>
                  <div className="text-xs font-mono mb-2 opacity-60">{h.date}</div><div className="font-black truncate text-lg italic uppercase">{h.place || "PRACTICE"}</div>
                  <div className="mt-4 text-[10px] border-t pt-2 flex justify-between opacity-80 font-bold uppercase"><span>{h.shots.length} Shots</span><span className={editingId===h.id ? 'text-emerald-400' : 'text-emerald-600'}>Hits {h.shots.filter(s=>s.zone==="的な").length}</span></div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 w-full bg-black/90 text-white p-4 flex justify-around items-center z-50 border-t border-gray-800 backdrop-blur-md">
        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div><span className="text-[10px] font-mono text-gray-400 uppercase italic text-white">V7.8 Stable Restore</span></div>
        <div className="flex gap-4 text-white">
          <button onClick={() => importFileRef.current?.click()} className="bg-gray-800 px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 hover:bg-gray-700 transition active:scale-95"><Upload size={14}/>読込</button>
          <button onClick={()=>{const d=localStorage.getItem(STORAGE_KEY); if(!d) return; const b=new Blob([d],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=`backup.json`; a.click();}} className="bg-blue-600 px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 transition shadow-lg active:scale-95"><Database size={14}/>書出</button>
          <button onClick={() => { if(confirm("【警告】全データを消去して初期化しますか？")) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }} className="bg-red-900/40 px-3 py-2 rounded-xl text-[10px] font-black border border-red-800 hover:bg-red-800 transition">全消去</button>
          <button onClick={()=>window.location.reload()} className="bg-gray-900 px-4 py-2 rounded-xl border border-gray-800 hover:bg-black transition"><RefreshCw size={14}/></button>
        </div>
        <input ref={importFileRef} type="file" accept=".json" onChange={e => {
          const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ try { const i=JSON.parse(ev.target?.result as string); if(confirm("統合しますか？")){ const c=[...i,...history]; const u=Array.from(new Map(c.map(t=>[t.id,t])).values()); setHistory(u.sort((a:any,b:any)=>b.date.localeCompare(a.date))); localStorage.setItem(STORAGE_KEY,JSON.stringify(u)); } } catch(err){alert("Error");} }; r.readAsText(f);
        }} className="hidden" />
      </footer>
    </div>
  );
};

export default App;
