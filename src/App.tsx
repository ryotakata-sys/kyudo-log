import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Kyudo Shot Logger v3.5 (PWA-ready)
 * - 三的（中央＋左右）
 * - 的サイズ: 1/10、間隔: 9.6R（前回の3倍）
 * - 安土: v3.2比 さらに上方向に倍（高さ 8.8R）
 * - マーカーをドラッグで微調整（マウス＆タッチ）
 * - CSV出力：日付/場所/全体コメント/各射コメントを含む（改行安全）
 * - PNG出力：下部に 日付・場所・全体コメント・各射一覧（コメント含む）を描画
 * - localStorage 自動保存
 * - UI: 全体コメントを日付/場所の次の行、各射コメント欄ワイド化
 */

type Zone = "的" | "安土" | "階段" | "外";
type Shot = {
  id: number;
  x: number;
  y: number;
  r: number;
  ring: number;
  zone: Zone;
  comment: string;
  t: number;
};

export default function KyudoShotLogger() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(todayStr);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const selected = shots.find((s) => s.id === selectedId) || null;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const size = 640,
    padding = 16;
  const cx = size / 2,
    cy = size / 2;
  const RINGS = 5;

  // 的サイズ & 間隔
  const R_base = Math.min(cx, cy) - padding - 80;
  const R = R_base * 0.1; // 1/10
  const neighborOffset = R * 9.6; // 3.2R × 3

  // 三的中心
  const centers = [
    { x: cx - neighborOffset, y: cy },
    { x: cx, y: cy },
    { x: cx + neighborOffset, y: cy },
  ];

  // 安土（v3.2 → さらに上へ倍：高さ 8.8R、下端は据え置き）
  const azuchi = {
    x: centers[0].x - R * 1.6,
    y: cy - R * 6.8, // v3.2: -2.4R → さらに 4.4R 上へ
    w: centers[2].x + R * 1.6 - (centers[0].x - R * 1.6),
    h: R * 8.8,
    r: 18,
  };

  // 階段（安土幅に追従）
  const stairs = {
    x: azuchi.x,
    y: azuchi.y + azuchi.h + 16,
    w: azuchi.w,
    h: 56,
    steps: 3,
  };

  // ---- helpers ----
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));
  const computeRing = (rNorm: number) =>
    rNorm > 1
      ? 0
      : Math.max(
          1,
          Math.min(RINGS, Math.ceil(clamp(rNorm, 0, 0.999999) * RINGS))
        );

  function zoneFromPoint(px: number, py: number): Zone {
    const dx = px - cx,
      dy = cy - py;
    const rNorm = Math.hypot(dx, dy) / R;
    if (rNorm <= 1) return "的";
    if (
      px >= stairs.x &&
      px <= stairs.x + stairs.w &&
      py >= stairs.y &&
      py <= stairs.y + stairs.h
    )
      return "階段";
    if (
      px >= azuchi.x &&
      px <= azuchi.x + azuchi.w &&
      py >= azuchi.y &&
      py <= azuchi.y + azuchi.h
    )
      return "安土";
    return "外";
  }

  const nextId = () => shots.length + 1;

  function svgPointFromMouseEvent(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = (svg as any).createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const sp = pt.matrixTransform(ctm.inverse());
    return { x: sp.x, y: sp.y };
  }
  function svgPointFromTouchEvent(e: React.TouchEvent) {
    const svg = svgRef.current;
    if (!svg) return null;
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return null;
    const pt = (svg as any).createSVGPoint();
    pt.x = t.clientX;
    pt.y = t.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const sp = pt.matrixTransform(ctm.inverse());
    return { x: sp.x, y: sp.y };
  }

  // クリックで追加
  function handleTargetClick(e: React.MouseEvent) {
    if (dragId !== null) return; // ドラッグ中は無効
    const pt = svgPointFromMouseEvent(e);
    if (!pt) return;
    const dx = pt.x - cx,
      dy = cy - pt.y;
    const rNorm = Math.hypot(dx, dy) / R;
    const shot: Shot = {
      id: nextId(),
      x: dx / R,
      y: dy / R,
      r: rNorm,
      ring: computeRing(rNorm),
      zone: zoneFromPoint(pt.x, pt.y),
      comment: "",
      t: Date.now(),
    };
    setShots((p) => [...p, shot]);
    setSelectedId(shot.id);
  }

  // ドラッグ（マウス）
  function handleMarkerMouseDown(id: number, e: React.MouseEvent<SVGGElement>) {
    e.stopPropagation();
    setSelectedId(id);
    setDragId(id);
  }
  function handleSvgMouseMove(e: React.MouseEvent) {
    if (dragId === null) return;
    const pt = svgPointFromMouseEvent(e);
    if (!pt) return;
    const dxR = (pt.x - cx) / R,
      dyR = (cy - pt.y) / R;
    const rNorm = Math.hypot(dxR, dyR);
    const ring = computeRing(rNorm);
    const zone = zoneFromPoint(pt.x, pt.y);
    setShots((prev) =>
      prev.map((s) =>
        s.id === dragId ? { ...s, x: dxR, y: dyR, r: rNorm, ring, zone } : s
      )
    );
  }
  function handleSvgMouseUp() {
    setDragId(null);
  }

  // ドラッグ（タッチ）
  function handleMarkerTouchStart(
    id: number,
    e: React.TouchEvent<SVGGElement>
  ) {
    e.stopPropagation();
    setSelectedId(id);
    setDragId(id);
  }
  function handleSvgTouchMove(e: React.TouchEvent) {
    if (dragId === null) return;
    const pt = svgPointFromTouchEvent(e);
    if (!pt) return;
    const dxR = (pt.x - cx) / R,
      dyR = (cy - pt.y) / R;
    const rNorm = Math.hypot(dxR, dyR);
    const ring = computeRing(rNorm);
    const zone = zoneFromPoint(pt.x, pt.y);
    setShots((prev) =>
      prev.map((s) =>
        s.id === dragId ? { ...s, x: dxR, y: dyR, r: rNorm, ring, zone } : s
      )
    );
  }
  function handleSvgTouchEnd() {
    setDragId(null);
  }

  // 編集
  function undo() {
    setShots((p) => p.slice(0, -1));
    setSelectedId(null);
  }
  function removeSelected() {
    if (!selected) return;
    setShots((p) =>
      p.filter((s) => s.id !== selected.id).map((s, i) => ({ ...s, id: i + 1 }))
    );
    setSelectedId(null);
  }
  function clearAll() {
    if (!confirm("全ての矢所を削除します。よろしいですか？")) return;
    setShots([]);
    setSelectedId(null);
  }
  const updateComment = (id: number, v: string) =>
    setShots((p) => p.map((s) => (s.id === id ? { ...s, comment: v } : s)));

  // ---- CSV & PNG ----
  function sanitizeComment(val: string | undefined | null) {
    const v = val ?? "";
    let out = "";
    for (let i = 0; i < v.length; i++)
      out += v[i] === "\n" || v[i] === "\r" ? " " : v[i];
    return out;
  }
  function csvEscape(val: any) {
    if (val === undefined || val === null) return "";
    const v = String(val);
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return '"' + v.split('"').join('""') + '"';
    }
    return v;
  }
  function exportCSV() {
    const header = [
      "date",
      "place",
      "note",
      "id",
      "x",
      "y",
      "r",
      "ring",
      "zone",
      "comment",
      "timestamp",
    ];
    const rows = shots.map((s) => [
      date,
      place,
      note,
      s.id,
      s.x.toFixed(4),
      s.y.toFixed(4),
      s.r.toFixed(4),
      s.ring,
      s.zone,
      sanitizeComment(s.comment),
      s.t,
    ]);
    const csv = [
      header.map(csvEscape).join(","),
      ...rows.map((r) => r.map(csvEscape).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kyudo_shots_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function wrapLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxW: number
  ) {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width <= maxW) cur = t;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  async function exportPNG() {
    const svg = svgRef.current;
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const svgW = svg.viewBox.baseVal.width,
        svgH = svg.viewBox.baseVal.height;

      const pad = 16,
        lineH = 18,
        maxTextWidth = svgW - pad * 2;

      const tmp = document.createElement("canvas");
      const tctx = tmp.getContext("2d")!;
      tctx.font = "14px sans-serif";

      const header = `日付: ${date}　場所: ${place}`;
      const noteLines = wrapLines(
        tctx,
        `全体コメント: ${note || "(なし)"}`,
        maxTextWidth
      );

      const shotLines: string[] = shots.map((s) => {
        const xy = `x=${s.x.toFixed(3)}, y=${s.y.toFixed(3)}`;
        const base = `#${s.id} [${s.zone}${s.ring ? `/${s.ring}` : ""}] ${xy}`;
        const c = sanitizeComment(s.comment || "");
        return c ? `${base} ｜ ${c}` : base;
      });
      const wrappedShotLines = shotLines.flatMap((l) =>
        wrapLines(tctx, l, maxTextWidth)
      );

      const metaLines =
        1 + noteLines.length + Math.max(1, wrappedShotLines.length);
      const metaPanelH = pad * 2 + lineH * metaLines;

      const canvas = document.createElement("canvas");
      canvas.width = svgW;
      canvas.height = svgH + metaPanelH;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(img, 0, 0);

      const y0 = svgH;
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, y0, svgW, metaPanelH);
      ctx.strokeStyle = "#e5e7eb";
      ctx.strokeRect(0.5, y0 + 0.5, svgW - 1, metaPanelH - 1);

      ctx.fillStyle = "#111827";
      ctx.font = "14px sans-serif";
      let y = y0 + pad + 12;

      ctx.fillText(header, pad, y);
      y += lineH;

      for (const ln of noteLines) {
        ctx.fillText(ln, pad, y);
        y += lineH;
      }

      ctx.strokeStyle = "#e5e7eb";
      ctx.beginPath();
      ctx.moveTo(pad, y - lineH / 2);
      ctx.lineTo(svgW - pad, y - lineH / 2);
      ctx.stroke();

      ctx.fillStyle = "#111827";
      for (const ln of wrappedShotLines) {
        ctx.fillText(ln, pad, y);
        y += lineH;
      }

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `kyudo_${date}.png`;
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, "image/png");

      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // ---- localStorage ----
  useEffect(() => {
    const key = "kyudo_shot_logger_v3";
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const obj = JSON.parse(saved);
        setDate(obj.date ?? todayStr);
        setPlace(obj.place ?? "");
        setNote(obj.note ?? "");
        setShots(Array.isArray(obj.shots) ? obj.shots : []);
      }
    } catch {}
  }, [todayStr]);
  useEffect(() => {
    const key = "kyudo_shot_logger_v3";
    try {
      localStorage.setItem(key, JSON.stringify({ date, place, note, shots }));
    } catch {}
  }, [date, place, note, shots]);

  // 描画補助
  const markerXY = (s: Shot) => ({ x: cx + s.x * R, y: cy - s.y * R });
  const zoneColor = (z: Zone) =>
    z === "的"
      ? { fill: "#ef4444", stroke: "#111827" }
      : z === "安土"
      ? { fill: "#f59e0b", stroke: "#78350f" }
      : z === "階段"
      ? { fill: "#8b5cf6", stroke: "#4c1d95" }
      : { fill: "#6b7280", stroke: "#111827" };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4">
      <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[700px,1fr]">
        {/* 左：シーン */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h1 className="text-xl font-semibold mb-2">弓道 矢所ログ</h1>
          <div className="text-sm text-gray-500 mb-2">
            クリック／ドラッグで矢所を操作（的／安土／階段／外）
          </div>

          <svg
            ref={svgRef}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={`rounded-xl border bg-white ${
              dragId !== null ? "cursor-grabbing" : "cursor-crosshair"
            }`}
            onClick={handleTargetClick}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
            onTouchMove={handleSvgTouchMove}
            onTouchEnd={handleSvgTouchEnd}
          >
            {/* 背景 */}
            <rect x={0} y={0} width={size} height={size} fill="#fff" />

            {/* 安土 */}
            <rect
              x={azuchi.x}
              y={azuchi.y}
              width={azuchi.w}
              height={azuchi.h}
              rx={azuchi.r}
              ry={azuchi.r}
              fill="#F5E6C8"
              stroke="#C9AE7D"
              strokeWidth={2}
            />
            <text
              x={azuchi.x + azuchi.w - 8}
              y={azuchi.y + 20}
              textAnchor="end"
              fontSize={12}
              fill="#7c5d2f"
            >
              安土
            </text>

            {/* 階段 */}
            {[...Array(stairs.steps)].map((_, i) => {
              const stepH = stairs.h / stairs.steps,
                y = stairs.y + i * stepH;
              return (
                <rect
                  key={i}
                  x={stairs.x}
                  y={y}
                  width={stairs.w}
                  height={stepH - 2}
                  fill="#e5e7eb"
                  stroke="#9ca3af"
                />
              );
            })}
            <text
              x={stairs.x + stairs.w - 8}
              y={stairs.y - 6}
              textAnchor="end"
              fontSize={12}
              fill="#6b7280"
            >
              階段
            </text>

            {/* 三的 */}
            {centers.map((c, ci) => (
              <g key={ci}>
                {[...Array(RINGS)].map((_, i) => {
                  const frac = 1 - i / RINGS,
                    rad = R * frac;
                  const fill = i % 2 === 0 ? "#111827" : "#f9fafb";
                  return (
                    <circle
                      key={i}
                      cx={c.x}
                      cy={c.y}
                      r={rad}
                      fill={fill}
                      stroke="#9ca3af"
                      strokeWidth={i === 0 ? 2 : 1}
                    />
                  );
                })}
                {ci === 1 && (
                  <>
                    <line
                      x1={c.x - R}
                      x2={c.x + R}
                      y1={c.y}
                      y2={c.y}
                      stroke="#e5e7eb"
                      strokeWidth={1}
                    />
                    <line
                      x1={c.x}
                      x2={c.x}
                      y1={c.y - R}
                      y2={c.y + R}
                      stroke="#e5e7eb"
                      strokeWidth={1}
                    />
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={R}
                      fill="none"
                      stroke="#111827"
                      strokeWidth={2}
                    />
                  </>
                )}
              </g>
            ))}

            {/* 矢マーカー */}
            {shots.map((s) => {
              const { x, y } = markerXY(s);
              const isSel = s.id === selectedId;
              const c = zoneColor(s.zone);
              return (
                <g
                  key={s.t}
                  onMouseDown={(ev) => handleMarkerMouseDown(s.id, ev)}
                  onTouchStart={(ev) => handleMarkerTouchStart(s.id, ev)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedId(s.id);
                  }}
                  style={{ cursor: "grab" }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill={c.fill}
                    stroke={c.stroke}
                    strokeWidth={isSel ? 3 : 2}
                  />
                  <text
                    x={x}
                    y={y + 4}
                    fontSize={11}
                    textAnchor="middle"
                    fill="#fff"
                  >
                    {s.id}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={undo}
              className="px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm"
              disabled={shots.length === 0}
            >
              一手戻す
            </button>
            <button
              onClick={removeSelected}
              className="px-3 py-1.5 bg-gray-100 border rounded-md text-sm"
              disabled={!selected}
            >
              選択を削除
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1.5 bg-gray-100 border rounded-md text-sm"
              disabled={shots.length === 0}
            >
              全てクリア
            </button>
            <button
              onClick={exportPNG}
              className="px-3 py-1.5 bg-gray-100 border rounded-md text-sm"
              disabled={shots.length === 0}
            >
              PNGとして保存
            </button>
            <button
              onClick={exportCSV}
              className="px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm"
              disabled={shots.length === 0}
            >
              CSV出力
            </button>
          </div>
        </div>

        {/* 右：メモ＆一覧 */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold mb-3">稽古メモ</h2>

          {/* 1行目：日付・場所 */}
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded-md p-2"
            />
            <input
              type="text"
              placeholder="稽古場所"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className="border rounded-md p-2"
            />
          </div>

          {/* 2行目：全体コメント（横幅いっぱい） */}
          <div className="mt-3">
            <label className="text-sm text-gray-600 block mb-1">
              全体コメント
            </label>
            <textarea
              rows={3}
              placeholder="例：本日は風あり。離れで弓手が流れやすい 等"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="border rounded-md p-2 w-full"
            />
          </div>

          {/* 一覧テーブル */}
          {/* 一覧（コメント欄をワイド化） */}
          <div className="mt-4 max-h-[500px] overflow-auto border-t">
            {shots.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                左の的をタップして記録を開始してください。
              </div>
            ) : (
              <div className="divide-y">
                {shots.map((s) => (
                  <div
                    key={s.t}
                    className={`p-3 transition-colors ${
                      s.id === selectedId ? "bg-red-50" : "bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="bg-gray-800 text-white w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold shadow-sm">
                        {s.id}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-semibold ${
                          s.zone === "的"
                            ? "bg-red-100 text-red-700"
                            : s.zone === "安土"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {s.zone}
                      </span>
                    </div>
                    <div className="w-full">
                      <input
                        className="w-full border border-gray-300 rounded-lg p-3 text-base focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                        value={s.comment}
                        onChange={(e) => updateComment(s.id, e.target.value)}
                        placeholder={`${s.id}射目のコメントを入力...`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="text-xs text-gray-500 mt-4 max-w-6xl mx-auto">
        ヒント：番号をドラッグで微調整できます。CSV/PNGはコメント含めて保存されます。ホーム追加でオフライン起動OK。
      </footer>
    </div>
  );
}
