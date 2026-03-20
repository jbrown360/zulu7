/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'zulu-orange': '#853d1a',
            },
            keyframes: {
                shake: {
                    '0%, 100%': { transform: 'rotate(0deg)' },
                    '25%': { transform: 'rotate(15deg)' },
                    '50%': { transform: 'rotate(-15deg)' },
                    '75%': { transform: 'rotate(10deg)' },
                    '85%': { transform: 'rotate(-10deg)' },
                }
            },
            animation: {
                shake: 'shake 0.4s ease-in-out infinite',
            }
        },
    },
    plugins: [],
}
