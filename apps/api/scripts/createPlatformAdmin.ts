import { emailSchema, passwordSchema } from '@smartseed/shared';
import { createDb } from '../src/db/db';
import { loadConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { writeAudit } from '../src/audit/audit';

/** Bootstrap the first platform administrator: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-platform-admin */
async function main(): Promise<void> {
  const config = loadConfig();
  const email = emailSchema.parse(process.env.ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
  const db = createDb(config.DATABASE_URL);
  const id = await db.withSystem(async (tx) => {
    const res = await tx.query<{ id: string }>(
      'INSERT INTO users (tenant_id, email, full_name, password_hash) VALUES (NULL, $1, $2, $3) RETURNING id',
      [email, 'Platform Administrator', await hashPassword(password)],
    );
    const userId = res.rows[0]?.id as string;
    await tx.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'platform_admin'", [userId]);
    await writeAudit(tx, { tenantId: null, actorId: userId, action: 'platform_admin.bootstrapped', entityType: 'user', entityId: userId });
    return userId;
  });
  console.log(`Platform admin created: ${id} (MFA enrollment is required at first login)`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
