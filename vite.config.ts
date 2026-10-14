import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { crashLivePlugin } from "./live-plugin";

export default defineConfig({
  plugins: [react(), crashLivePlugin()],
  test: {
    environment: "node",
  },
});
