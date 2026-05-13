/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          ink: '#182230',
          mist: '#f4f0e8',
          sand: '#dac7a8',
          moss: '#3f5f4a',
          ember: '#c7643b'
        }
      },
      fontFamily: {
        display: ['Georgia', 'ui-serif', 'serif'],
        body: ['Avenir Next', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        card: '0 24px 70px rgba(34, 47, 62, 0.14)'
      }
    }
  },
  plugins: []
};
