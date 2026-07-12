import React, { useState, useEffect, useMemo, useRef } from "react";
import { Undo, Save, Calendar, Database, Upload, RefreshCw, BarChart2, X, Trash2 } from "lucide-react";

/**
 * 弓道「矢所ログ」V8.9 (Ultimate Core - Fluid Scroll & Anchor)
 * - 解決：V8.8で動かなかった問題を修正。縦スクロール（履歴閲覧）を常に許可。
 * - 安定：1.0倍時は横移動のみロックし、白画面迷子を100%防止。
 * - 操作：1.2倍速の移動と、摩擦0.94の滑らかな余韻を維持。
 * - UI：fixedヘッダー（z-1000）により、常に操作パネルを最前面に保持。
 */

type Shot = { id: number; x: number; y: number; zone: string; comment: string; };
type HistoryRecord = { id: number; date: string; place: string; note: string; shots: Shot[]; goal?: string; goalAchieved?: boolean | null; goalMemo?: string; };

const R = 50;
const R_INNER_BLACK = (R / 5) * 3; // 的の内側にある黒い輪（3番目の同心円）の半径
const TARGET_SPACING = 9.6 * R;
const ANDUCHI_W = TARGET_SPACING * 2 + R * 4;
const ANDUCHI_H = 8.8 * R;
const STAIRS_H = 3.0 * R;
const TARGET_CY = ANDUCHI_H / 3;
const VIEW_W = ANDUCHI_W + 100;
const VIEW_H = ANDUCHI_H + STAIRS_H + 100;
const STORAGE_KEY = "kyudo-log-history";

// 中央的を中心にしたゾーン（①〜⑧は的の外側、左右端は隣の的までの中間地点）
const ZONE_HALF_W = TARGET_SPACING / 2;
const ZONE_ROW_H = R * 0.65;

type ZoneGeom = {
  halfW: number;
  cy: number;
  upperMidTop: number;
  upperMidBottom: number;
  lowerMidTop: number;
  lowerMidBottom: number;
  zone7Top: number;
  zone8Bottom: number;
};

const getZoneGeom = (): ZoneGeom => {
  const cy = TARGET_CY;
  const rowH = ZONE_ROW_H;
  const azuchiBottom = ANDUCHI_H / 2; // 安土と階段の境界
  return {
    halfW: ZONE_HALF_W,
    cy,
    // ⑤⑥下辺・③④上辺 = 内側黒輪の上端 / ①②上辺・③④下辺 = 内側黒輪の下端
    upperMidTop: cy - R - rowH,
    upperMidBottom: cy - R_INNER_BLACK,
    lowerMidTop: cy + R_INNER_BLACK,
    // ①②下辺・⑧上辺 = 安土と階段の境界
    lowerMidBottom: azuchiBottom,
    zone7Top: -ANDUCHI_H / 2,
    zone8Bottom: azuchiBottom + STAIRS_H,
  };
};

type ZoneRect = { id: string; x0: number; y0: number; x1: number; y1: number };

const getZoneRects = (): ZoneRect[] => {
  const {
    halfW: hw, upperMidTop, upperMidBottom, lowerMidTop, lowerMidBottom,
    zone7Top, zone8Bottom,
  } = getZoneGeom();
  return [
    { id: "7", x0: -hw, y0: zone7Top, x1: hw, y1: upperMidTop },
    { id: "5", x0: -hw, y0: upperMidTop, x1: 0, y1: upperMidBottom },
    { id: "6", x0: 0, y0: upperMidTop, x1: hw, y1: upperMidBottom },
    // ③④は的寄りまで（的円内は getZone で0優先）。的側の縦線は描画しない
    { id: "3", x0: -hw, y0: upperMidBottom, x1: 0, y1: lowerMidTop },
    { id: "4", x0: 0, y0: upperMidBottom, x1: hw, y1: lowerMidTop },
    { id: "1", x0: -hw, y0: lowerMidTop, x1: 0, y1: lowerMidBottom },
    { id: "2", x0: 0, y0: lowerMidTop, x1: hw, y1: lowerMidBottom },
    { id: "8", x0: -hw, y0: lowerMidBottom, x1: hw, y1: zone8Bottom },
  ];
};

const ZONE_LABELS: Record<string, string> = {
  "0": "的", "1": "①", "2": "②", "3": "③", "4": "④",
  "5": "⑤", "6": "⑥", "7": "⑦", "8": "⑧",
};

/**
 * 期間分析の最大％を4等分した色濃さ。
 * ％が高いほど色を濃くする（不透明度: 低％20% → 高％80%）
 */
const ZONE_TIER_ALPHA = [0.2, 0.4, 0.6, 0.8] as const;

const getZonePct = (count: number, total: number) => (total > 0 ? (count / total) * 100 : 0);

const getMaxZonePct = (zoneCounts: Record<string, number>, total: number) =>
  Math.max(0, ...Array.from({ length: 9 }, (_, i) => getZonePct(zoneCounts[String(i)], total)));

const getZoneTierAlpha = (pct: number, maxPct: number) => {
  if (pct < 0.1 || maxPct <= 0) return 0;
  const step = maxPct / 4;
  if (pct <= step) return ZONE_TIER_ALPHA[0]; // 薄い
  if (pct <= step * 2) return ZONE_TIER_ALPHA[1];
  if (pct <= step * 3) return ZONE_TIER_ALPHA[2];
  return ZONE_TIER_ALPHA[3]; // 濃い
};

const zoneIntensity = (pct: number, maxPct: number) =>
  `rgba(220, 38, 38, ${getZoneTierAlpha(pct, maxPct)})`;

const zoneIntensitySolid = (pct: number, maxPct: number) => {
  const alpha = getZoneTierAlpha(pct, maxPct);
  if (alpha <= 0) return "rgba(156, 163, 175, 1)"; // 0%はグレー
  return `rgba(220, 38, 38, ${Math.min(1, alpha + 0.2)})`;
};

const isOnCenterTarget = (x: number, y: number) =>
  Math.sqrt(x * x + (y - TARGET_CY) ** 2) <= R;

const isHitZone = (zone: string) => zone === "0" || zone === "的" || zone === "的な";

const inRect = (x: number, y: number, r: ZoneRect) =>
  x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

const getZone = (x: number, y: number, treatTargetAsHit = true): string => {
  if (treatTargetAsHit && isOnCenterTarget(x, y)) return "0";
  for (const rect of getZoneRects()) {
    if (inRect(x, y, rect)) return rect.id;
  }
  const dx = x;
  const dy = y - TARGET_CY;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "7" : "8";
  return dx < 0 ? "3" : "4";
};

const zoneLabel = (zone: string) => ZONE_LABELS[zone] ?? zone;

const resolveShotZone = (shot: Shot) => getZone(shot.x, shot.y);

const getZoneCounts = (shots: Shot[]) => {
  const counts: Record<string, number> = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [String(i), 0])
  );
  shots.forEach(s => { counts[resolveShotZone(s)]++; });
  return counts;
};

const getTendencyAnalysis = (shots: Shot[]) => {
  if (shots.length === 0) return "";
  const total = shots.length;
  const avgX = shots.reduce((acc, s) => acc + s.x, 0) / total;
  const avgY = shots.reduce((acc, s) => acc + s.y, 0) / total;
  let report = `【傾向分析】\n`;
  if (avgX > 15) report += `・「右逸」傾向。妻手の緩みに注意。\n`;
  else if (avgX < -15) report += `・「前矢」傾向。押し手・物見を確認。\n`;
  else report += `・左右の筋は安定しています。\n`;
  if (avgY < TARGET_CY - 15) report += `・矢所が高い。狙いを確認。\n`;
  else if (avgY > TARGET_CY + 15) report += `・「下矢」傾向。肩の上がりを確認。\n`;
  else report += `・上下の高さが揃っています。\n`;
  return report;
};

const ZoneBreakdown: React.FC<{ total: number; zoneCounts: Record<string, number> }> = ({ total, zoneCounts }) => {
  const maxPct = getMaxZonePct(zoneCounts, total);
  return (
  <div className="space-y-3">
    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">ゾーン別射着率（{total}射）</p>
    {Array.from({ length: 9 }, (_, i) => {
      const count = zoneCounts[String(i)];
      const pct = getZonePct(count, total);
      const label = i === 0 ? "的（0）" : zoneLabel(String(i));
      const color = zoneIntensitySolid(pct, maxPct);
      return (
        <div key={i}>
          <div className="flex justify-between text-xs font-bold mb-1">
            <span style={{ color }}>{label}</span>
            <span style={{ color }}>{pct.toFixed(1)}% <span className="text-gray-400 font-medium">({count}射)</span></span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: zoneIntensity(pct, maxPct) }} />
          </div>
        </div>
      );
    })}
  </div>
  );
};

const ZoneOverlay: React.FC<{ zoneCounts: Record<string, number>; total: number; layer: "fills" | "decor" }> = ({ zoneCounts, total, layer }) => {
  const pct = (z: number) => getZonePct(zoneCounts[String(z)], total);
  const maxPct = getMaxZonePct(zoneCounts, total);
  const fill = (z: number) => zoneIntensity(pct(z), maxPct);
  const rects = getZoneRects();
  const g = getZoneGeom();
  const { halfW: hw, cy, upperMidTop, upperMidBottom, lowerMidTop, lowerMidBottom, zone7Top, zone8Bottom } = g;
  const clipId = `zone-outside-target-${layer}`;

  const zoneLabelPos: Record<string, [number, number]> = {
    "7": [0, (zone7Top + upperMidTop) / 2],
    "5": [-hw / 2, (upperMidTop + upperMidBottom) / 2],
    "6": [hw / 2, (upperMidTop + upperMidBottom) / 2],
    "3": [-hw / 2, cy],
    "4": [hw / 2, cy],
    "1": [-hw / 2, (lowerMidTop + lowerMidBottom) / 2],
    "2": [hw / 2, (lowerMidTop + lowerMidBottom) / 2],
    "8": [0, (lowerMidBottom + zone8Bottom) / 2],
  };

  // 的円をくり抜くクリップ（他ゾーンの線・塗りがゾーン0に被らない）
  const outsideTargetClip = (
    <defs>
      <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        <path
          clipRule="evenodd"
          d={`M ${-hw - 2} ${zone7Top - 2} H ${hw + 2} V ${zone8Bottom + 2} H ${-hw - 2} Z M ${R} ${cy} A ${R} ${R} 0 1 0 ${-R} ${cy} A ${R} ${R} 0 1 0 ${R} ${cy}`}
        />
      </clipPath>
    </defs>
  );

  if (layer === "fills") {
    return (
      <g pointerEvents="none">
        {outsideTargetClip}
        <g clipPath={`url(#${clipId})`}>
          {rects.map(r => (
            <rect key={`fill-${r.id}`} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill={fill(Number(r.id))} />
          ))}
        </g>
        <circle cx={0} cy={cy} r={R} fill={fill(0)} />
      </g>
    );
  }

  // 境界線：③④の的側（±R）の縦線は描かず、的円までゾーンが続く見た目にする
  const lineRects = rects.filter(r => r.id !== "3" && r.id !== "4");

  return (
    <g pointerEvents="none">
      {outsideTargetClip}
      <g clipPath={`url(#${clipId})`}>
        {lineRects.map(r => (
          <rect key={`line-${r.id}`} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="none" stroke="#dc2626" strokeWidth={1.5} />
        ))}
        {/* ③④は外枠・上下・中央縦線のみ（的寄りの縦線なし） */}
        <line x1={-hw} y1={upperMidBottom} x2={-hw} y2={lowerMidTop} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={hw} y1={upperMidBottom} x2={hw} y2={lowerMidTop} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={-hw} y1={upperMidBottom} x2={0} y2={upperMidBottom} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={0} y1={upperMidBottom} x2={hw} y2={upperMidBottom} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={-hw} y1={lowerMidTop} x2={0} y2={lowerMidTop} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={0} y1={lowerMidTop} x2={hw} y2={lowerMidTop} stroke="#dc2626" strokeWidth={1.5} />
        <line x1={0} y1={upperMidBottom} x2={0} y2={lowerMidTop} stroke="#dc2626" strokeWidth={1.5} />
        <rect x={-hw} y={zone7Top} width={hw * 2} height={zone8Bottom - zone7Top} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      </g>
      {/* ゾーン0は的の円のみ */}
      <circle cx={0} cy={cy} r={R} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      {Object.entries(zoneLabelPos).map(([z, [lx, ly]]) => (
        <g key={z}>
          <circle cx={lx} cy={ly} r={14} fill="white" stroke="#dc2626" strokeWidth={1.5} />
          <text x={lx} y={ly} fontSize={13} textAnchor="middle" dominantBaseline="central" fontWeight="900" fill="#dc2626">{z}</text>
        </g>
      ))}
      <g>
        <circle cx={0} cy={cy} r={14} fill="white" stroke="#dc2626" strokeWidth={1.5} />
        <text x={0} y={cy} fontSize={13} textAnchor="middle" dominantBaseline="central" fontWeight="900" fill="#dc2626">0</text>
      </g>
    </g>
  );
};

const App: React.FC = () => {
  const [shots, setShots] = useState<Shot[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [goalAchieved, setGoalAchieved] = useState<boolean | null>(null);
  const [goalMemo, setGoalMemo] = useState("");
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
  const velocityRef = useRef({ x: 0, y: 0 });
  const inertiaRequestRef = useRef<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setHistory(JSON.parse(saved).sort((a: any, b: any) => b.date.localeCompare(a.date)));
  }, []);

  const filteredHistory = useMemo(() => isRangeMode ? history.filter(h => h.date >= startDate && h.date <= endDate) : history, [history, isRangeMode, startDate, endDate]);

  const stats = useMemo(() => {
    const all = filteredHistory.flatMap(h => h.shots);
    const zoneCounts = getZoneCounts(all);
    const hits = zoneCounts["0"];
    return {
      total: all.length,
      hits,
      rate: all.length > 0 ? ((hits / all.length) * 100).toFixed(1) : "0.0",
      zoneCounts,
      all,
    };
  }, [filteredHistory]);

  const resetUI = () => { setEditingId(null); setShots([]); setPlace(""); setNote(""); setGoal(""); setGoalAchieved(null); setGoalMemo(""); setZoom(1); setOffset({ x: 0, y: 0 }); };

  const saveRecord = () => {
    const newId = editingId || Date.now();
    const newH = editingId ?
      history.map(h => h.id === editingId ? { ...h, date, place, note, shots, goal, goalAchieved, goalMemo } : h) : [{ id: newId, date, place, note, shots, goal, goalAchieved, goalMemo }, ...history];
    const sorted = [...newH].sort((a, b) => b.date.localeCompare(a.date));
    setHistory(sorted);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    setEditingId(newId);
    alert("保存完了");
  };

  const loadHistory = (h: HistoryRecord) => {
    setIsRangeMode(false); setEditingId(h.id); setDate(h.date); setPlace(h.place); setNote(h.note); setShots(h.shots); setGoal(h.goal || ""); setGoalAchieved(h.goalAchieved ?? null); setGoalMemo(h.goalMemo || ""); setZoom(1); setOffset({x:0, y:0});
  };

  const deleteRecord = () => {
    if (!editingId || !confirm("この記録を削除しますか？")) return;
    const newH = history.filter(h => h.id !== editingId);
    setHistory(newH);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newH));
    resetUI();
  };

  // リミッター：1.0倍時は横方向(x)のみロック、縦方向(y)はスクロールを許可
  const clampOffset = (x: number, y: number, z: number) => {
    const limitX = z <= 1.05 ? 0 : window.innerWidth * 0.8 * z;
    const limitY_Top = 100; // ヘッダー付近の遊び
    const limitY_Bottom = -8000; // 長い履歴に対応するため下方向は広く
    return {
      x: Math.max(Math.min(x, limitX), -limitX),
      y: Math.max(Math.min(y, limitY_Top), limitY_Bottom)
    };
  };

  const applyInertia = () => {
    if (Math.abs(velocityRef.current.x) < 0.2 && Math.abs(velocityRef.current.y) < 0.2) {
      if (inertiaRequestRef.current) cancelAnimationFrame(inertiaRequestRef.current);
      return;
    }
    setOffset(prev => {
      const nextX = prev.x + velocityRef.current.x;
      const nextY = prev.y + velocityRef.current.y;
      return clampOffset(nextX, nextY, zoom);
    });
    velocityRef.current.x *= 0.94;
    velocityRef.current.y *= 0.94;
    inertiaRequestRef.current = requestAnimationFrame(applyInertia);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (inertiaRequestRef.current) {
      cancelAnimationFrame(inertiaRequestRef.current);
      inertiaRequestRef.current = null;
    }
    velocityRef.current = { x: 0, y: 0 };
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
        setOffset(prev => {
          // ズームアウト時は横(x)だけを原点に戻し、縦スクロール位置(y)は維持
          const rawX = nextZoom <= 1.02 ? 0 : centerX - (centerX - prev.x) * (nextZoom / zoom);
          const rawY = centerY - (centerY - prev.y) * (nextZoom / zoom);
          return clampOffset(rawX, rawY, nextZoom);
        });
        setZoom(nextZoom);
      }
      touchDistRef.current = dist;
    } else if (e.touches.length === 1) {
      const dx = (e.touches[0].clientX - lastTouchRef.current.x) * 1.2;
      const dy = (e.touches[0].clientY - lastTouchRef.current.y) * 1.2;
      velocityRef.current = { x: dx, y: dy };
      setOffset(prev => clampOffset(prev.x + dx, prev.y + dy, zoom));
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMultiTouchRef.current && !hasMovedRef.current) {
      handleInteraction(e);
    } else if (hasMovedRef.current && !isMultiTouchRef.current) {
      inertiaRequestRef.current = requestAnimationFrame(applyInertia);
    }
  };

  const handleInteraction = (e: any) => {
    if (isRangeMode || !svgRef.current || hasMovedRef.current || isMultiTouchRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    const x = (clientX - rect.left - rect.width / 2) * (VIEW_W / rect.width);
    const y = (clientY - rect.top - rect.height / 2) * (VIEW_H / rect.height);
    const zone = getZone(x, y);
    setShots([...shots, { id: Date.now(), x, y, zone, comment: "" }]);
  };

  return (
    <div className="fixed inset-0 bg-white text-gray-900 font-sans overflow-hidden touch-none"
         style={{ touchAction: 'none' }}
         onTouchStart={handleTouchStart}
         onTouchMove={handleTouchMove}
         onTouchEnd={handleTouchEnd}
    >
      <header className="bg-black text-white px-8 py-5 flex justify-between items-center fixed top-0 left-0 w-full shadow-2xl"
              style={{ zIndex: 1000, isolation: 'isolate' }}>
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

      <div className="origin-top-left pt-[100px] w-full h-full"
        style={{ 
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
          willChange: 'transform'
        }}
      >
        <div className="p-8 pb-40">
          <main className="max-w-[95%] mx-auto grid lg:grid-cols-[1fr,400px] gap-8">
            <div className="space-y-6">
              <section className="bg-gray-50 p-6 rounded-3xl border space-y-4 shadow-sm">
                <div className="flex gap-10">
                  <div><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="bg-transparent text-2xl font-black outline-none text-slate-900" /></div>
                  <div className="flex-1"><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">Place</label><input type="text" value={place} onChange={e=>setPlace(e.target.value)} className="bg-transparent text-2xl font-black outline-none w-full border-b text-slate-900" placeholder="稽古場所" /></div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">Goal</label>
                  <input type="text" value={goal} onChange={e=>setGoal(e.target.value)} className="bg-transparent text-lg font-bold outline-none w-full border-b text-slate-900" placeholder="本日の稽古目標" />
                </div>
                {goal && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-widest">Reflection (達成の有無とメモ)</label>
                    <div className="flex gap-4 items-start">
                      <div className="flex flex-col gap-2 shrink-0">
                        <button onClick={() => setGoalAchieved(true)} className={`px-4 py-2 rounded-xl text-xs font-bold transition ${goalAchieved === true ? 'bg-emerald-600 text-white shadow-md' : 'bg-white border text-gray-500 hover:bg-gray-50'}`}>達成 ⭕️</button>
                        <button onClick={() => setGoalAchieved(false)} className={`px-4 py-2 rounded-xl text-xs font-bold transition ${goalAchieved === false ? 'bg-red-600 text-white shadow-md' : 'bg-white border text-gray-500 hover:bg-gray-50'}`}>未達成 ❌</button>
                      </div>
                      <textarea value={goalMemo} onChange={e=>setGoalMemo(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-xl p-3 outline-none text-sm resize-none text-slate-900" placeholder="振り返りメモ..." rows={3} />
                    </div>
                  </div>
                )}
              </section>

              <div className="relative rounded-[2.5rem] border-4 border-gray-100 overflow-hidden bg-gray-100 shadow-inner">
                <svg ref={svgRef} viewBox={`-${(ANDUCHI_W+100)/2} -${(ANDUCHI_H+STAIRS_H+100)/2} ${ANDUCHI_W+100} ${ANDUCHI_H+STAIRS_H+100}`} className="w-full h-auto cursor-crosshair">
                  <rect x={-ANDUCHI_W/2} y={-ANDUCHI_H/2} width={ANDUCHI_W} height={ANDUCHI_H} fill="#d2b48c" />
                  <rect x={-ANDUCHI_W/2} y={ANDUCHI_H/2} width={ANDUCHI_W} height={STAIRS_H} fill="#4a634a" />
                  {isRangeMode && stats.total > 0 && <ZoneOverlay zoneCounts={stats.zoneCounts} total={stats.total} layer="fills" />}
                  {[-TARGET_SPACING, 0, TARGET_SPACING].map(ox => (
                    <g key={ox} transform={`translate(${ox}, ${ANDUCHI_H/3})`}>
                      {[5,4,3,2,1].map(i => (<circle key={i} r={(R/5)*i} fill={i%2===0 ? "white" : "black"} stroke="#333" strokeWidth="0.5" />))}
                    </g>
                  ))}
                  {isRangeMode && stats.total > 0 && <ZoneOverlay zoneCounts={stats.zoneCounts} total={stats.total} layer="decor" />}
                  {(isRangeMode ? stats.all : shots).map((s, idx) => (
                    <g key={s.id} transform={`translate(${s.x}, ${s.y})`}>
                      {isRangeMode ? (
                        <circle r={4} fill="rgba(55,65,81,0.75)" />
                      ) : (
                        <>
                          <circle r={14} fill="white" stroke={isHitZone(s.zone) ? "#ef4444" : "#374151"} strokeWidth={2.5} />
                          <text fontSize={12} textAnchor="middle" dominantBaseline="central" fontWeight="900" fill={isHitZone(s.zone) ? "#ef4444" : "#374151"}>{idx+1}</text>
                        </>
                      )}
                    </g>
                  ))}
                </svg>
              </div>
              <div className="flex justify-end items-center gap-4 text-white">
                <button onClick={() => { setZoom(1); setOffset({x:0, y:0}); }} className="px-4 py-2 bg-white border rounded-xl text-xs text-slate-500 font-bold shadow-sm">リセット</button>
                <button onClick={()=>setShots(shots.slice(0,-1))} className="bg-black text-white px-8 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg transition active:scale-95 text-white" disabled={isRangeMode}><Undo size={20}/>戻す</button>
              </div>
            </div>

            <aside className="space-y-6">
              <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-6 h-[500px] overflow-y-auto shadow-sm">
                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 flex justify-between italic tracking-widest font-bold"><span>{isRangeMode ? '期間分析' : 'Shots Note'}</span></h3>
                {!isRangeMode ?
                shots.map((s, i) => (
                  <div key={s.id} className="flex gap-3 mb-4 border-b border-gray-50 pb-4 items-center text-slate-900">
                    <div className="w-7 h-7 bg-black text-white rounded-full flex items-center justify-center font-bold text-[10px] shrink-0">{i+1}</div>
                    <button onClick={() => { const n=[...shots]; n[i].zone = isHitZone(s.zone) ? getZone(s.x, s.y, false) : "0"; setShots(n); }}
                      className={`text-xs font-black shrink-0 w-10 text-left ${isHitZone(s.zone) ? "text-red-600" : "text-gray-500"}`}>
                      {zoneLabel(s.zone)}
                    </button>
                    <input value={s.comment} onChange={e=>{const n=[...shots]; n[i].comment=e.target.value; setShots(n);}} className="flex-1 outline-none text-sm border-l pl-3 font-medium" placeholder="備考..." />
                  </div>
                )) : stats.total === 0 ? (
                  <div className="text-sm text-gray-500">データがありません。</div>
                ) : (
                  <div className="space-y-5">
                    <ZoneBreakdown total={stats.total} zoneCounts={stats.zoneCounts} />
                    <div className="bg-gray-50 p-5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap font-medium text-gray-700 border border-gray-200">{getTendencyAnalysis(stats.all)}</div>
                  </div>
                )}
              </div>
              <textarea value={note} onChange={e=>setNote(e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-[2rem] p-6 h-32 outline-none text-sm resize-none shadow-inner text-slate-900 font-bold" placeholder="全体まとめ..." />
            </aside>
          </main>

          <section className="mt-20 border-t pt-10 px-4">
            <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest italic tracking-[0.3em] mb-8 text-center text-slate-400">History Archive</h2>
            <div className="bg-gray-100 p-4 rounded-3xl flex items-center justify-center gap-4 border shadow-inner mb-8 max-w-2xl mx-auto">
               <Calendar size={14} className="text-gray-400"/><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none text-slate-900" />
               <span className="text-gray-300">〜</span><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none text-slate-900" />
               <button onClick={() => { setIsRangeMode(true); setZoom(1); setOffset({x:0, y:0}); }} className="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition hover:bg-gray-800 shadow-md text-white"><BarChart2 size={14}/>期間分析</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="p-6 rounded-3xl border text-center bg-gray-50 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 italic">Total</span><span className="text-4xl font-black text-slate-800">{stats.total}</span></div>
              <div className="p-6 rounded-3xl border text-center bg-emerald-50 border-emerald-100 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 text-emerald-600 italic">Zone 0</span><span className="text-4xl font-black text-emerald-600">{stats.hits}</span></div>
              <div className="p-6 rounded-3xl border text-center bg-blue-50 border-blue-100 shadow-sm"><span className="text-[10px] font-black text-gray-400 block mb-1 text-blue-700 italic">Rate</span><span className="text-4xl font-black text-blue-700">{stats.rate}%</span></div>
            </div>
            {isRangeMode && stats.total > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3 mb-12">
                {Array.from({ length: 9 }, (_, i) => {
                  const count = stats.zoneCounts[String(i)];
                  const pct = getZonePct(count, stats.total);
                  const maxPct = getMaxZonePct(stats.zoneCounts, stats.total);
                  const color = zoneIntensitySolid(pct, maxPct);
                  return (
                    <div key={i} className="p-4 rounded-2xl border text-center shadow-sm" style={{ backgroundColor: zoneIntensity(pct, maxPct), borderColor: color }}>
                      <span className="text-[10px] font-black block mb-1" style={{ color }}>{i === 0 ? "的" : zoneLabel(String(i))}</span>
                      <span className="text-2xl font-black block" style={{ color }}>{pct.toFixed(1)}%</span>
                      <span className="text-[10px] font-bold text-gray-500">{count}射</span>
                    </div>
                  );
                })}
              </div>
            )}
            {!isRangeMode && <div className="mb-12" />}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {filteredHistory.map(h => (
                <button key={h.id} onClick={()=>loadHistory(h)} className={`p-6 rounded-[2rem] border-4 text-left transition-all flex flex-col justify-between ${editingId===h.id ? "bg-black text-white border-black shadow-2xl scale-105" : "bg-white border-gray-100 hover:border-gray-200 shadow-sm text-slate-900"}`}>
                  <div className="w-full">
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-xs font-mono opacity-60">{h.date}</div>
                      {h.goal && (
                        <div className="text-sm" title={h.goal}>{h.goalAchieved === true ? '⭕️' : h.goalAchieved === false ? '❌' : '➖'}</div>
                      )}
                    </div>
                    <div className="font-black truncate text-lg italic uppercase">{h.place || "PRACTICE"}</div>
                  </div>
                  <div className="mt-4 text-[10px] border-t pt-2 flex justify-between opacity-80 font-bold uppercase w-full"><span>{h.shots.length} Shots</span><span className={editingId===h.id ? 'text-emerald-400' : 'text-emerald-600'}>Hits {h.shots.filter(s => isHitZone(s.zone)).length}</span></div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 w-full bg-black/90 text-white p-4 flex justify-around items-center z-[1000] border-t border-gray-800 backdrop-blur-md">
        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div><span className="text-[10px] font-mono text-gray-400 uppercase italic text-white">V8.9 Fluid Scroll</span></div>
        <div className="flex gap-4">
          <button onClick={() => importFileRef.current?.click()} className="bg-gray-800 px-4 py-2 rounded-xl text-[10px] font-black text-white">読込</button>
          <button onClick={()=>{const d=localStorage.getItem(STORAGE_KEY); if(!d) return; const b=new Blob([d],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=`backup.json`; a.click();}} className="bg-blue-600 px-4 py-2 rounded-xl text-[10px] font-black text-white">書出</button>
          <button onClick={() => { if(confirm("【警告】全データを消去して初期化しますか？")) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }} className="bg-red-900/40 px-3 py-2 rounded-xl text-[10px] font-black border border-red-800 hover:bg-red-800 transition">全消去</button>
          <button onClick={()=>window.location.reload()} className="bg-gray-900 px-4 py-2 rounded-xl border border-gray-800 text-white"><RefreshCw size={14}/></button>
        </div>
        <input ref={importFileRef} type="file" accept=".json" onChange={e => {
          const f=e.target.files?.[0];
          if(!f) return; const r=new FileReader(); r.onload=ev=>{ try { const i=JSON.parse(ev.target?.result as string); if(confirm("統合しますか？")){ const c=[...i,...history]; const u=Array.from(new Map(c.map(t=>[t.id,t])).values()); setHistory(u.sort((a:any,b:any)=>b.date.localeCompare(a.date))); localStorage.setItem(STORAGE_KEY,JSON.stringify(u));
          } } catch(err){alert("Error");} }; r.readAsText(f);
        }} className="hidden" />
      </footer>
    </div>
  );
};

export default App;
