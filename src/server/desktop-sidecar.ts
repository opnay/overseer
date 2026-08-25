import { createPersistentApi } from "./api.ts";
import {
  forwardDesktopApiRequest,
  type DesktopApiRequest,
  type DesktopApiResponse,
} from "./desktop-api.ts";

const api = createPersistentApi();

function write(value: DesktopApiResponse | { ready: true }): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function handle(line: string): Promise<void> {
  let id = 0;
  try {
    const input = JSON.parse(line) as DesktopApiRequest;
    if (!Number.isSafeInteger(input.id) || input.id < 1) throw new Error("요청 ID가 잘못됐습니다.");
    id = input.id;
    write(await forwardDesktopApiRequest(api, input));
  } catch (error) {
    console.error(error);
    write({
      body: JSON.stringify({
        error: {
          code: "desktop_bridge_error",
          message: "데스크톱 API 요청을 처리하지 못했습니다.",
        },
      }),
      id,
      status: 500,
    });
  }
}

write({ ready: true });

let buffer = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  buffer += chunk;
  let boundary = buffer.indexOf("\n");
  while (boundary >= 0) {
    const line = buffer.slice(0, boundary).trim();
    buffer = buffer.slice(boundary + 1);
    if (line) await handle(line);
    boundary = buffer.indexOf("\n");
  }
}
