export function json(data: unknown, init: ResponseInit = {}): Response {
  const body = JSON.stringify(data, null, 2);
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(body, { ...init, headers });
}

export function text(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { ...init, headers });
}

export async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function notFound(): Response {
  return json({ error: "Not Found" }, { status: 404 });
}

