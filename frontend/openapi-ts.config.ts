import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "http://localhost:8000/schema/openapi.json",
  output: {
    path: "src/api/generated",
    format: "prettier",
    lint: "eslint",
  },
  client: {
    name: "@hey-api/client-fetch",
  },
  plugins: [
    "@tanstack/react-query",
    {
      name: "@hey-api/typescript",
      enums: "javascript",
    },
  ],
});
