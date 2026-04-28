"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

// ── Constants ─────────────────────────────────────────────────────────────────
const GAME_DURATION        = 120;
const PTS                  = 1;
const SKIP_PENALTY         = 0;

// PIXEL mode
const PIXEL_REVEAL_DURATION = 20;        // secondes pour révélation complète
const PIXEL_STEPS           = 10;        // nombre d'étapes
const PIXEL_STEP_DURATION   = PIXEL_REVEAL_DURATION / PIXEL_STEPS; // 3s par étape
const PIXEL_K               = 9;         // constante courbe hyperbolique
const PIXEL_SIZES           = [4, 6, 8, 12, 16, 24, 32, 48, 64, 128, 380];

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize = (s = "") =>
  s.toLowerCase()
   .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // accents
   .replace(/[''`.\/\-_]/g, "")                        // points, tirets, slashes → rien (R.A.S → ras)
   .replace(/[^a-z0-9\s]/g, " ")                        // reste → espace
   .replace(/\s+/g, " ")
   .trim();

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function maxDist(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

const isClose = (input, target) => {
  const a = normalize(input);
  const b = normalize(target);
  if (!a || a.length < 2) return false;
  if (a === b) return true;
  // Un mot du target matche exactement (ex: "kendrick" → "Kendrick Lamar")
  const bWords = b.split(" ");
  if (bWords.some(w => w === a && a.length >= 3)) return true;
  // Préfixe (ex: "kendrick lam")
  if (b.startsWith(a) && a.length >= 4) return true;
  // Levenshtein global
  if (levenshtein(a, b) <= maxDist(b.length)) return true;
  // Levenshtein mot par mot
  const aWords = a.split(" ");
  if (aWords.length > 1 && bWords.length > 1) {
    const allMatch = aWords.every((aw, i) => {
      const bw = bWords[i] || "";
      return levenshtein(aw, bw) <= maxDist(bw.length);
    });
    if (allMatch) return true;
  }
  return false;
};

const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

// ── Crop aléatoire — 1/4 visible, coin aléatoire ─────────────────────────────
// Le div interne fait 200%x200%, positionné sur le coin choisi.
// overflow:hidden sur le parent = seul 1/4 est visible.
const CORNERS = [
  { top: "0",    left: "0",    bottom: "auto", right: "auto"  }, // haut-gauche
  { top: "0",    left: "auto", bottom: "auto", right: "0"     }, // haut-droit
  { top: "auto", left: "0",    bottom: "0",    right: "auto"  }, // bas-gauche
  { top: "auto", left: "auto", bottom: "0",    right: "0"     }, // bas-droit
];
const randomCrop = () => CORNERS[Math.floor(Math.random() * CORNERS.length)];

const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// ── Pixel size from step index ────────────────────────────────────────────────
function getPixelSize(step) {
  return PIXEL_SIZES[Math.min(step, PIXEL_SIZES.length - 1)];
}

// ── Hyperbolic score (1/x curve) ─────────────────────────────────────────────
function pixelScore(elapsed) {
  const t = Math.min(elapsed / PIXEL_REVEAL_DURATION, 1);
  return Math.max(20, Math.round(1 + 99 * (1 / (1 + PIXEL_K * t))));
}

export default function CoverQuiz() {
  // screens: home | countdown | game | end
  const [screen, setScreen]       = useState("home");
  const [genre, setGenre]         = useState("ALL");
  const [gameMode, setGameMode]   = useState("CROP"); // CROP | PIXEL
  const [albums, setAlbums]       = useState([]);
  const [loading, setLoading]     = useState(true);

  // game state
  const [queue, setQueue]         = useState([]);
  const [current, setCurrent]     = useState(null);
  const [timeLeft, setTimeLeft]   = useState(GAME_DURATION);
  const [score, setScore]         = useState(0);
  const [found, setFound]         = useState(false);
  const [input, setInput]         = useState("");
  const [history, setHistory]     = useState([]);
  const [imgReady, setImgReady]   = useState(false);
  const [shaking, setShaking]     = useState(false);
  const [cropPos, setCropPos]     = useState(CORNERS[0]);
  const [countdown, setCountdown] = useState(3);
  const [skipped, setSkipped]     = useState(0);
  const [playerName, setPlayerName] = useState("");
  const [submitted, setSubmitted]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);

  const [pixelStep,    setPixelStep]    = useState(0);
  const [pixelElapsed, setPixelElapsed] = useState(0);

  const inputRef    = useRef(null);
  const timerRef    = useRef(null);
  const cdRef       = useRef(null);
  const pixelRef    = useRef(null);
  const canvasRef   = useRef(null);
  const pixelImgRef = useRef(null);

  // ── Load albums ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let q = supabase.from("albums").select("id,artist,album,genre,cover_url");
      if (genre !== "ALL") q = q.eq("genre", genre);
      const { data, error } = await q;
      if (!error && data) setAlbums(data);
      setLoading(false);
    };
    load();
  }, [genre]);

  // ── Countdown before game ───────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setCountdown(3);
    setScreen("countdown");
    let n = 3;
    cdRef.current = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(cdRef.current);
        launchGame();
      } else {
        setCountdown(n);
      }
    }, 900);
  }, [albums]); // eslint-disable-line

  const launchGame = useCallback(() => {
    const pool = gameMode === "PIXEL" ? shuffle(albums).slice(0, 10) : shuffle(albums);
    const [first, ...rest] = pool;
    setCurrent(first);
    setQueue(rest);
    setFound(false);
    setInput("");
    setScore(0);
    setHistory([]);
    setSkipped(0);
    setPlayerName("");
    setSubmitted(false);
    setTimeLeft(GAME_DURATION);
    setImgReady(false);
    setCropPos(randomCrop());
    setScreen("game");
  }, [albums]);

  // ── Timer (CROP mode uniquement) ────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "game" || gameMode !== "CROP") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setScreen("end");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, gameMode]);

  // ── Pixel timer — reset + progression par album ─────────────────────────────
  useEffect(() => {
    if (screen !== "game" || gameMode !== "PIXEL") return;
    clearInterval(pixelRef.current);
    setPixelStep(0);
    setPixelElapsed(0);
    let elapsed = 0;
    pixelRef.current = setInterval(() => {
      elapsed++;
      setPixelElapsed(elapsed);
      setPixelStep(Math.min(Math.floor(elapsed / PIXEL_STEP_DURATION), PIXEL_STEPS));
      if (elapsed >= PIXEL_REVEAL_DURATION) clearInterval(pixelRef.current);
    }, 1000);
    return () => clearInterval(pixelRef.current);
  }, [current?.id, screen, gameMode]); // eslint-disable-line

  // ── Canvas pixelation ────────────────────────────────────────────────────────
  const drawPixelated = useCallback((img, ps) => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;
    const SIZE = 380;
    const off  = document.createElement("canvas");
    off.width  = ps;
    off.height = ps;
    const offCtx = off.getContext("2d");
    offCtx.imageSmoothingEnabled = false;
    offCtx.drawImage(img, 0, 0, ps, ps);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(off, 0, 0, SIZE, SIZE);
    setImgReady(true);
  }, []);

  // Redessine à chaque étape (l'img DOM est dans pixelImgRef)
  useEffect(() => {
    if (gameMode !== "PIXEL") return;
    drawPixelated(pixelImgRef.current, getPixelSize(pixelStep));
  }, [pixelStep, gameMode, drawPixelated]);

  // Focus input when game starts
  useEffect(() => {
    if (screen === "game") inputRef.current?.focus();
  }, [screen, current]);

  // ── Auto-advance when found ──────────────────────────────────────────────────
  useEffect(() => {
    if (found) {
      const t = setTimeout(() => advance(false), 700);
      return () => clearTimeout(t);
    }
  }, [found]); // eslint-disable-line

  // ── Auto-advance when PIXEL fully revealed without answer ────────────────────
  useEffect(() => {
    if (gameMode !== "PIXEL" || pixelStep < PIXEL_STEPS || found) return;
    const t = setTimeout(() => advance(true), 2000);
    return () => clearTimeout(t);
  }, [pixelStep, gameMode, found]); // eslint-disable-line

  // ── Advance to next card ─────────────────────────────────────────────────────
  const advance = useCallback((wasSkipped = false) => {
    setHistory((h) => [
      ...h,
      { ...current, foundAlbum: found },
    ]);
    if (wasSkipped) setSkipped((s) => s + 1);

    if (queue.length === 0) {
      setScreen("end");
      return;
    }
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
    setFound(false);
    setInput("");
    setImgReady(false);
    setCropPos(randomCrop());
  }, [current, found, queue]);

  // ── Guess handler ────────────────────────────────────────────────────────────
  const handleGuess = useCallback(() => {
    const val = input.trim();
    if (!val || !current || found) return;
    if (gameMode === "PIXEL" && pixelStep >= PIXEL_STEPS) return;

    if (isClose(val, current.album)) {
      const pts = gameMode === "PIXEL" ? pixelScore(pixelElapsed) : PTS;
      setFound(true);
      setScore((s) => s + pts);
    } else {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
    }

    setInput("");
    inputRef.current?.focus();
  }, [input, current, found, gameMode, pixelStep, pixelElapsed]);

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  const fetchLeaderboard = useCallback(async () => {
    const { data } = await supabase
      .from("scores")
      .select("player, score, genre, game_mode, created_at")
      .eq("game_mode", gameMode)
      .order("score", { ascending: false })
      .limit(10);
    if (data) setLeaderboard(data);
  }, [gameMode]);

  useEffect(() => {
    if (screen === "end" || screen === "home") fetchLeaderboard();
  }, [screen, gameMode, fetchLeaderboard]);

  const submitScore = async () => {
    if (!playerName.trim() || submitted || score === 0) return;
    setSubmitting(true);
    await supabase.from("scores").insert({
      player: playerName.trim().toUpperCase(),
      score,
      genre,
      game_mode: gameMode,
    });
    setSubmitted(true);
    setSubmitting(false);
    fetchLeaderboard();
  };

  // ── Timer color ──────────────────────────────────────────────────────────────
  const pct = (timeLeft / GAME_DURATION) * 100;
  const timerColor =
    pct > 50 ? "var(--c-cyan)" :
    pct > 20 ? "var(--c-gold)" :
               "var(--c-accent)";
  const isCritical = pct <= 20;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    }}>

      {/* ── HOME ────────────────────────────────────────────────────────────── */}
      {screen === "home" && (
        <div className="animate-fadeUp" style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 32, maxWidth: 400, width: "100%",
        }}>
          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(64px, 18vw, 96px)",
              letterSpacing: 6,
              lineHeight: 1,
              color: "var(--c-text)",
              position: "relative",
            }}>
              <span className="glitch" data-text="COVER">COVER</span>
            </div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(64px, 18vw, 96px)",
              letterSpacing: 6,
              lineHeight: 1,
              color: "var(--c-accent)",
            }}>
              QUIZ
            </div>
            <p style={{ color: "var(--c-muted)", fontSize: 12, letterSpacing: 2, marginTop: 8 }}>
              {gameMode === "PIXEL" ? "10 COVERS — LE PLUS VITE POSSIBLE" : "2 MINUTES — AUTANT QUE POSSIBLE"}
            </p>
          </div>

          {/* Genre filter */}
          <div>
            <p style={{ color: "var(--c-muted)", fontSize: 11, letterSpacing: 2, textAlign: "center", marginBottom: 12 }}>
              SÉLECTIONNER UN MODE
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { key: "ALL", label: "🌍 TOUT" },
                { key: "FR",  label: "🇫🇷 RAP FR" },
                { key: "US",  label: "🇺🇸 RAP US" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  className={`pill ${genre === key ? "active" : ""}`}
                  onClick={() => setGenre(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Game mode filter */}
          <div>
            <p style={{ color: "var(--c-muted)", fontSize: 11, letterSpacing: 2, textAlign: "center", marginBottom: 12 }}>
              STYLE D'INDICE
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { key: "CROP",  label: "✂️ CROP" },
                { key: "PIXEL", label: "◼ PIXEL" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  className={`pill ${gameMode === key ? "active" : ""}`}
                  onClick={() => setGameMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          {!loading && (
            <div className="animate-fadeUp delay-200" style={{
              display: "flex", gap: 24, borderTop: "1px solid var(--c-border)",
              borderBottom: "1px solid var(--c-border)", padding: "16px 0", width: "100%",
              justifyContent: "center",
            }}>
              <Stat label="ALBUMS" value={albums.length} />
              <Stat label="DURÉE"  value="2:00" />
              <Stat label="MAX"    value={`${albums.length} pts`} />
            </div>
          )}

          {/* Rules */}
          <div className="animate-fadeUp delay-300" style={{
            fontSize: 11, color: "var(--c-muted)", lineHeight: 1.8,
            letterSpacing: 1, width: "100%",
          }}>
            {gameMode === "PIXEL" ? (
              <>
                <div>→ Cover révélée en {PIXEL_STEPS} étapes sur {PIXEL_REVEAL_DURATION}s</div>
                <div>→ Plus vite tu trouves, plus tu scores (max 100pts)</div>
                <div>→ ENTRÉE pour valider — tolérance aux fautes</div>
              </>
            ) : (
              <>
                <div>→ +{PTS} pt par album trouvé</div>
                <div>→ ENTRÉE pour valider — tolérance aux fautes</div>
              </>
            )}
          </div>

          {/* CTA */}
          <Link href="/" style={{ textDecoration: "none", width: "100%" }}>
            <button style={{
              width: "100%", padding: "12px", background: "none",
              border: "1px solid var(--c-border)", color: "var(--c-muted)",
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2,
              cursor: "pointer", marginBottom: 8,
            }}>
              ← ACCUEIL
            </button>
          </Link>
          <button
            className="btn-cta animate-fadeUp delay-400"
            onClick={startCountdown}
            disabled={loading || albums.length === 0}
          >
            {loading ? "CHARGEMENT…" : "LANCER LE JEU"}
          </button>

          {/* Leaderboard home */}
          {leaderboard.length > 0 && (
            <div className="animate-fadeUp delay-500" style={{ width: "100%" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, margin: "8px 0 10px",
              }}>
                <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-muted)" }}>
                  🏆 TOP 10 — {gameMode}
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {leaderboard.map((entry, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "8px 12px",
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-border)",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-display)", fontSize: 18,
                      color: i === 0 ? "var(--c-gold)" : i === 1 ? "#aaa" : i === 2 ? "#cd7f32" : "var(--c-muted)",
                      minWidth: 24,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, letterSpacing: 1 }}>{entry.player}</span>
                    {entry.genre && entry.genre !== "ALL" && (
                      <span style={{ fontSize: 10 }}>{entry.genre === "FR" ? "🇫🇷" : "🇺🇸"}</span>
                    )}
                    <span style={{
                      fontFamily: "var(--font-display)", fontSize: 20, color: "var(--c-gold)",
                    }}>
                      {entry.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── COUNTDOWN ───────────────────────────────────────────────────────── */}
      {screen === "countdown" && (
        <div style={{ textAlign: "center" }}>
          <div
            key={countdown}
            className="animate-countdown"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 180,
              color: countdown === 1 ? "var(--c-accent)" : "var(--c-text)",
              lineHeight: 1,
            }}
          >
            {countdown}
          </div>
          <p style={{ color: "var(--c-muted)", letterSpacing: 4, fontSize: 13 }}>
            PRÉPARE-TOI
          </p>
        </div>
      )}

      {/* ── GAME ────────────────────────────────────────────────────────────── */}
      {screen === "game" && current && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 14, width: "100%", maxWidth: 420,
        }}>

          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", width: "100%",
          }}>
            {/* Score */}
            <div style={{ minWidth: 70 }}>
              <div style={{
                fontFamily: "var(--font-display)",
                fontSize: 36, color: "var(--c-gold)", lineHeight: 1,
              }}>
                {score}
              </div>
              <div style={{ fontSize: 10, color: "var(--c-muted)", letterSpacing: 2 }}>
                POINTS
              </div>
            </div>

            {/* Centre : timer (CROP) ou compteur covers (PIXEL) */}
            <div style={{ flex: 1, padding: "0 16px", textAlign: "center" }}>
              {gameMode === "CROP" ? (
                <>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 42, color: timerColor, lineHeight: 1,
                    transition: "color .5s",
                    ...(isCritical ? { animation: "timerPulse 1s infinite" } : {}),
                  }}>
                    {fmt(timeLeft)}
                  </div>
                  <div style={{ height: 3, background: "var(--c-border)", marginTop: 6 }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: timerColor,
                      transition: "width 1s linear, background .5s",
                    }} />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 42, color: "var(--c-muted)", lineHeight: 1 }}>
                    {queue.length + 1}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--c-muted)", letterSpacing: 2, marginTop: 2 }}>
                    RESTANTS
                  </div>
                </>
              )}
            </div>

            {/* Queue (CROP uniquement) */}
            {gameMode === "CROP" && (
              <div style={{ minWidth: 70, textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--c-muted)" }}>
                  {queue.length + 1}
                </div>
                <div style={{ fontSize: 10, color: "var(--c-muted)", letterSpacing: 2 }}>
                  RESTANTS
                </div>
              </div>
            )}
          </div>

          {/* Cover */}
          <div
            className={shaking ? "animate-shake" : ""}
            style={{
              width: "100%", maxWidth: 380,
              aspectRatio: "1/1",
              position: "relative",
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              overflow: "hidden",
            }}
          >
            {/* Skeleton */}
            {!imgReady && (
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, #111 25%, #1a1a2e 50%, #111 75%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.2s infinite",
              }} />
            )}

            {gameMode === "CROP" ? (
              /* Div zoomé x2 — overflow:hidden = 1/4 visible */
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                <div style={{
                  position: "absolute",
                  width: "200%",
                  height: "200%",
                  top:    cropPos.top,
                  left:   cropPos.left,
                  bottom: cropPos.bottom,
                  right:  cropPos.right,
                  opacity: imgReady ? 1 : 0,
                  transition: "opacity .25s",
                }}>
                  <Image
                    key={current.id}
                    src={current.cover_url}
                    alt="pochette"
                    fill
                    className="animate-popIn"
                    style={{ objectFit: "cover" }}
                    onLoad={() => setImgReady(true)}
                    sizes="840px"
                    priority
                  />
                </div>
              </div>
            ) : (
              /* Mode PIXEL — img cachée + canvas */
              <>
                <img
                  key={current.id}
                  ref={pixelImgRef}
                  src={current.cover_url}
                  alt=""
                  style={{ display: "none" }}
                  onLoad={() => drawPixelated(pixelImgRef.current, getPixelSize(pixelStep))}
                />
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={380}
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%",
                    opacity: imgReady ? 1 : 0,
                    transition: "opacity .25s",
                    imageRendering: "pixelated",
                  }}
                />
              </>
            )}

            {/* Overlay révélation PIXEL */}
            {gameMode === "PIXEL" && pixelStep >= PIXEL_STEPS && !found && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.55)",
              }}>
                <div style={{
                  textAlign: "center", padding: "14px 24px",
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-accent)",
                }}>
                  <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--c-muted)", marginBottom: 6 }}>
                    C'ÉTAIT
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display)", fontSize: 18,
                    color: "var(--c-accent)", letterSpacing: 2,
                  }}>
                    {current.album}
                  </div>
                </div>
              </div>
            )}

            {/* Corner badge */}
            <div style={{
              position: "absolute", top: 10, right: 10,
              background: "var(--c-accent)", color: "#fff",
              fontFamily: "var(--font-mono)", fontSize: 10,
              padding: "3px 8px", letterSpacing: 2,
            }}>
              {current.genre}
            </div>
          </div>

          {/* Pixel progress bar */}
          {gameMode === "PIXEL" && (
            <div style={{ width: "100%", height: 3, background: "var(--c-border)" }}>
              <div style={{
                height: "100%",
                width: `${(pixelStep / PIXEL_STEPS) * 100}%`,
                background: pixelStep >= PIXEL_STEPS ? "var(--c-accent)" : "var(--c-cyan)",
                transition: "width 1s linear",
              }} />
            </div>
          )}

          {/* Answer tags */}
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <div className={`answer-tag ${found ? "found" : ""}`}>
              <span>{found ? current.album : "ALBUM ?"}</span>
              {gameMode === "PIXEL"
                ? <span style={{ fontSize: 10, opacity: .5 }}>max {pixelScore(0)}pts → 1pt</span>
                : <span style={{ fontSize: 10, opacity: .5 }}>+{PTS}pt</span>
              }
            </div>
          </div>

          {/* Input */}
          {(() => {
            const revealed = gameMode === "PIXEL" && pixelStep >= PIXEL_STEPS;
            return (
              <div style={{ display: "flex", gap: 0, width: "100%" }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleGuess(); }}
                  placeholder={revealed ? current.album : "Tape ta réponse…"}
                  className="quiz-input"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  disabled={revealed}
                  style={revealed ? { opacity: 0.4, cursor: "not-allowed" } : {}}
                />
                <button className="quiz-submit" onClick={handleGuess} disabled={revealed}>→</button>
              </div>
            );
          })()}

          {/* Skip */}
          {!(gameMode === "PIXEL" && pixelStep >= PIXEL_STEPS) && (
            <button
              onClick={() => advance(true)}
              style={{
                background: "none", border: "none",
                color: "var(--c-muted)", cursor: "pointer",
                fontFamily: "var(--font-mono)", fontSize: 11,
                letterSpacing: 2,
              }}
            >
              PASSER ⟩
            </button>
          )}
        </div>
      )}

      {/* ── END ─────────────────────────────────────────────────────────────── */}
      {screen === "end" && (
        <div className="animate-fadeUp" style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 28, maxWidth: 420, width: "100%",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 13, letterSpacing: 6, color: "var(--c-muted)", marginBottom: 8,
            }}>
              TEMPS ÉCOULÉ
            </div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(80px, 22vw, 120px)",
              lineHeight: 1,
              background: "linear-gradient(135deg, var(--c-gold), var(--c-accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              {score}
            </div>
            <div style={{ color: "var(--c-muted)", fontSize: 12, letterSpacing: 2 }}>
              POINTS
            </div>
          </div>

          {/* Stats row */}
          <div style={{
            display: "flex", gap: 20,
            borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)",
            padding: "16px 0", width: "100%", justifyContent: "center",
          }}>
            <Stat label="TROUVÉS" value={history.filter((a) => a.foundAlbum).length} />
            <Stat label="PASSÉS"  value={skipped} />
          </div>

          {/* Tableau covers trouvées / passées */}
          {history.length > 0 && (
            <div style={{ width: "100%" }}>

              {/* Trouvées */}
              {history.filter(a => a.foundAlbum).length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  }}>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                    <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-gold)" }}>
                      ✓ TROUVÉS — {history.filter(a => a.foundAlbum).length}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {history.filter(a => a.foundAlbum).map((a) => (
                      <div key={a.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "8px 10px",
                        background: "rgba(255,214,10,.04)",
                        border: "1px solid var(--c-gold)",
                      }}>
                        <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
                          <Image src={a.cover_url} alt={a.album} fill style={{ objectFit: "cover" }} sizes="44px" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: "var(--c-gold)",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {a.album}
                          </div>
                        </div>
                        <div style={{
                          fontFamily: "var(--font-display)", fontSize: 18, color: "var(--c-gold)",
                        }}>
                          +1
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passées */}
              {history.filter(a => !a.foundAlbum).length > 0 && (
                <div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  }}>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                    <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-muted)" }}>
                      ✗ PASSÉS — {history.filter(a => !a.foundAlbum).length}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {history.filter(a => !a.foundAlbum).map((a) => (
                      <div key={a.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "8px 10px",
                        background: "var(--c-surface)",
                        border: "1px solid var(--c-border)",
                        opacity: 0.6,
                      }}>
                        <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
                          <Image src={a.cover_url} alt={a.album} fill style={{ objectFit: "cover", filter: "grayscale(100%)" }} sizes="44px" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 700, color: "var(--c-text)",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {a.album}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--c-muted)" }}>—</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Submit score */}
          {score > 0 && !submitted && (
            <div style={{ width: "100%" }}>
              <p style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-muted)", marginBottom: 8 }}>
                ENREGISTRE TON SCORE
              </p>
              <div style={{ display: "flex", gap: 0 }}>
                <input
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value.slice(0, 16))}
                  onKeyDown={e => e.key === "Enter" && submitScore()}
                  placeholder="TON NOM"
                  maxLength={16}
                  className="quiz-input"
                  style={{ textTransform: "uppercase" }}
                />
                <button
                  className="quiz-submit"
                  onClick={submitScore}
                  disabled={submitting || !playerName.trim()}
                >
                  {submitting ? "…" : "OK"}
                </button>
              </div>
            </div>
          )}
          {submitted && (
            <div style={{
              width: "100%", padding: "12px 16px",
              border: "1px solid var(--c-gold)",
              background: "rgba(255,214,10,.05)",
              color: "var(--c-gold)", fontSize: 12, letterSpacing: 2,
              textAlign: "center",
            }}>
              ✓ SCORE ENREGISTRÉ
            </div>
          )}

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div style={{ width: "100%" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
              }}>
                <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
                <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-muted)" }}>
                  🏆 TOP 10 — {gameMode}
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {leaderboard.map((entry, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "8px 12px",
                    background: entry.player === playerName.trim().toUpperCase() && submitted
                      ? "rgba(255,214,10,.06)" : "var(--c-surface)",
                    border: entry.player === playerName.trim().toUpperCase() && submitted
                      ? "1px solid var(--c-gold)" : "1px solid var(--c-border)",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 18,
                      color: i === 0 ? "var(--c-gold)" : i === 1 ? "#aaa" : i === 2 ? "#cd7f32" : "var(--c-muted)",
                      minWidth: 24,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, letterSpacing: 1 }}>
                      {entry.player}
                    </span>
                    {entry.genre && entry.genre !== "ALL" && (
                      <span style={{ fontSize: 10, color: "var(--c-muted)" }}>
                        {entry.genre === "FR" ? "🇫🇷" : "🇺🇸"}
                      </span>
                    )}
                    <span style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 20,
                      color: "var(--c-gold)",
                    }}>
                      {entry.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <button className="btn-cta" onClick={startCountdown}>
            REJOUER
          </button>
          <Link href="/" style={{ textDecoration: "none" }}>
            <button style={{
              background: "none", border: "none", color: "var(--c-muted)",
              cursor: "pointer", fontFamily: "var(--font-mono)",
              fontSize: 11, letterSpacing: 2,
            }}>
              ← ACCUEIL
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontFamily: "var(--font-display)",
        fontSize: 28, color: "var(--c-text)", lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: "var(--c-muted)", letterSpacing: 2, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
