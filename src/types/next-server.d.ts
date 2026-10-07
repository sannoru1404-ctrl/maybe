declare module 'next/server' {
  export const NextResponse: typeof Response & { json(body: unknown, init?: ResponseInit): Response };
}
