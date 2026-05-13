/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          ink: 'rgb(var(--market-ink) / <alpha-value>)',
          muted: 'rgb(var(--market-muted) / <alpha-value>)',
          mist: 'rgb(var(--market-mist) / <alpha-value>)',
          paper: 'rgb(var(--market-paper) / <alpha-value>)',
          line: 'rgb(var(--market-line) / <alpha-value>)',
          accent: 'rgb(var(--market-accent) / <alpha-value>)',
          accentText: 'rgb(var(--market-accent-text) / <alpha-value>)',
          nav: 'rgb(var(--market-nav) / <alpha-value>)',
          navText: 'rgb(var(--market-nav-text) / <alpha-value>)',
          sand: 'rgb(var(--market-sand) / <alpha-value>)',
          moss: 'rgb(var(--market-moss) / <alpha-value>)',
          ember: 'rgb(var(--market-ember) / <alpha-value>)'
        }
      },
      fontFamily: {
        display: ['Segoe UI', 'Aptos', 'sans-serif'],
        body: ['Segoe UI', 'Aptos', 'sans-serif']
      },
      boxShadow: {
        card: 'var(--market-shadow-card)',
        search: 'var(--market-shadow-search)'
      }
    }
  },
  plugins: []
};
