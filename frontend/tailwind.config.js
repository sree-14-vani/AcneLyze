/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B2E4B',
        muted: '#5C6B7F',
        line: '#E3E9F0',
        powder: '#F3F6F9',
        lavender: '#F3F6F9',
        peach: '#F8EEE7',
        sky: '#315A85',
        plum: '#1B2E4B',
        coral: '#C27859',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 10px 32px -20px rgba(27, 46, 75, 0.22)',
        float: '0 24px 64px -30px rgba(27, 46, 75, 0.32)',
      },
      borderRadius: {
        card: '18px',
      },
    },
  },
  plugins: [],
};
