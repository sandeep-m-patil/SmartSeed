import { ErrorCode } from './constants';

export class ContractError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ContractError';
    this.code = code;
  }
}
