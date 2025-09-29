import { json, notFound, readJson } from "../utils/response";

export type RouteHandler = (req: Request, url: URL) => Promise<Response> | Response;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class Router {
  private routes: Map<string, RouteHandler> = new Map();

  on(method: Method, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const key = `${req.method as Method} ${url.pathname}`;
    const handler = this.routes.get(key);
    if (!handler) return notFound();
    return handler(req, url);
  }
}

export function buildRouter(): Router {
  const router = new Router();

  router.on("GET", "/", () => new Response("OK"));
  router.on("GET", "/healthz", () => json({ status: "ok" }));

  router.on("GET", "/api/time", () => json({ now: new Date().toISOString() }));

  router.on("POST", "/api/echo", async (req) => {
    const body = await readJson(req);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });
    return json({ youSent: body });
  });

  return router;
}

