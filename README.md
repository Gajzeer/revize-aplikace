# Revize – pracovní přehled

Webová aplikace pro revizního technika: termíny revizí, klienti a objekty, faktury a výdělky, ceník, doklady a kalibrace přístrojů.

- Frontend: Vite + React (`src/`), nasazení na GitHub Pages (`.github/workflows/pages.yml`) po každém pushi do main: https://gajzeer.github.io/revize-aplikace/
- Data: Supabase (Postgres + přihlášení). Přístup jen pro povolené e-maily (RLS).
- Lokálně: `npm install`, `npm run dev`.
