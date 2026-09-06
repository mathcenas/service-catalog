/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          primary: 'var(--color-primary)',   // #0B192C — header, estructura
          accent:  'var(--color-accent)',    // #06B6D4 — botones, links, badges activos
          surface: 'var(--color-surface)',   // #1E293B — cards oscuras, contraste
        },
      },
      fontFamily: {
        brand: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
