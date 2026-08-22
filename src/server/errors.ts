export class ExpectedError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 503;

  constructor(code: string, message: string, status: ExpectedError["status"]) {
    super(message);
    this.name = "ExpectedError";
    this.code = code;
    this.status = status;
  }
}
