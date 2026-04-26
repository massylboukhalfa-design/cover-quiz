import "./globals.css";

export const metadata = {
  title: "Cover Quiz — Reconnais les pochettes",
  description: "2 minutes pour deviner le maximum de pochettes rap",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
