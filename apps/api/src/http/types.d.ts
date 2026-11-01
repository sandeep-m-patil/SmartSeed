import type { Role } from '@smartseed/shared';

export interface AuthContext {
  userId: string;
  tenantId: string | null;
  orgId: string | null;
  roles: Role[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}
