"use client";

import Link from "next/link";

const GAMES = [
  {
    slug:        "cover-quiz",
    title:       "COVER QUIZ",
    description: "Reconnais les pochettes de rap en 2 minutes",
    emoji:       "🎵",
    color:       "var(--c-accent)",
  },
];

export default function Home() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 48,
    }}>

      {/* Logo plateforme */}
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(48px, 12vw, 80px)",
          letterSpacing: 8,
          lineHeight: 1,
          color: "var(--c-text)",
        }}>
          RAP
        </div>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(48px, 12vw, 80px)",
          letterSpacing: 8,
          lineHeight: 1,
          color: "var(--c-accent)",
        }}>
          GAMES
        </div>
        <p style={{
          color: "var(--c-muted)",
          fontSize: 11,
          letterSpacing: 3,
          marginTop: 8,
        }}>
          TESTE TA CULTURE RAP
        </p>
      </div>

      {/* Grille de jeux */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        maxWidth: 420,
      }}>
        {GAMES.map((game) => (
          <GameCard key={game.slug} {...game} />
        ))}
      </div>

    </div>
  );
}

function GameCard({ slug, title, description, emoji, color }) {
  return (
    <Link href={`/games/${slug}`} style={{ textDecoration: "none" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 24px",
        background: "var(--c-surface)",
        border: `1px solid var(--c-border)`,
        cursor: "pointer",
        transition: "border-color .2s, background .2s",
        clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
      }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = color;
          e.currentTarget.style.background = `rgba(255,45,85,.05)`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "var(--c-border)";
          e.currentTarget.style.background = "var(--c-surface)";
        }}
      >
        <div style={{ fontSize: 36 }}>{emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: 24,
            letterSpacing: 3,
            color: "var(--c-text)",
          }}>
            {title}
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--c-muted)",
            letterSpacing: 1,
            marginTop: 2,
          }}>
            {description}
          </div>
        </div>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          color: color,
        }}>
          →
        </div>
      </div>
    </Link>
  );
}
