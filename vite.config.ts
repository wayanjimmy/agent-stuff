export default {
  test: {
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      typebox: new URL("./test/mocks/typebox.ts", import.meta.url).pathname,
      "@sinclair/typebox": new URL("./test/mocks/typebox.ts", import.meta.url).pathname,
      "@mariozechner/pi-coding-agent": new URL("./test/mocks/pi-coding-agent.ts", import.meta.url)
        .pathname,
      "@mariozechner/pi-tui": new URL("./test/mocks/pi-tui.ts", import.meta.url).pathname,
    },
  },
};
