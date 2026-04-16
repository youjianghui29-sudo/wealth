import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        paper: "#f7f9fb",
        line: "#d9e2e8",
        mint: "#0f8f72",
        coral: "#d94f45",
        steel: "#3f6f8f"
      },
      boxShadow: {
        panel: "0 12px 28px rgba(23, 32, 38, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
