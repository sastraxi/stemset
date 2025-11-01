import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
	plugins: [
		// TanStack Router plugin should come before React
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/auth": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
			"/media": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
		},
	},
});
