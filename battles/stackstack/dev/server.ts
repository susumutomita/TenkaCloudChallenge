const PORT = Number(Bun.env.PORT ?? 5655);
const HERE = new URL(".", import.meta.url).pathname;

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(`${HERE}index.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/app.js") {
      const built = await Bun.build({ entrypoints: [`${HERE}app.tsx`], target: "browser", format: "esm", sourcemap: "inline" });
      if (!built.success || !built.outputs[0]) return new Response("bundle failed", { status: 500 });
      return new Response(built.outputs[0], { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`StackStack local UI harness: http://localhost:${PORT}`);
