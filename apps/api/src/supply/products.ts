import type { CreateProductInput } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import { conflict, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { decodeCursor, toPage } from '../lib/pagination';
import type { Actor, TenantActor } from './actor';

const UNIQUE_VIOLATION = '23505';

interface ProductRow {
  id: string; name: string; brand: string; crop_type: string; variety: string; category: string;
  description: string; packaging: unknown; regulatory_ids: unknown; created_at: Date;
}

const toDto = (p: ProductRow) => ({
  id: p.id, name: p.name, brand: p.brand, cropType: p.crop_type, variety: p.variety, category: p.category,
  description: p.description, packaging: p.packaging, regulatoryIds: p.regulatory_ids, createdAt: p.created_at,
});

export async function insertCertifications(
  tx: Tx, tenantId: string, owner: { productId?: string; batchId?: string }, certs: CreateProductInput['certifications'],
): Promise<void> {
  for (const c of certs) {
    await tx.query(
      `INSERT INTO certifications (tenant_id, product_id, batch_id, type, issuer, number, valid_from, valid_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, owner.productId ?? null, owner.batchId ?? null, c.type, c.issuer, c.number, c.validFrom ?? null, c.validTo ?? null],
    );
  }
}

export function createProductService(db: Db) {
  async function create(actor: TenantActor, input: CreateProductInput) {
    try {
      return await db.withActor(actor, async (tx) => {
        const res = await tx.query<ProductRow>(
          `INSERT INTO products (tenant_id, name, brand, crop_type, variety, category, description, packaging, regulatory_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [actor.tenantId, input.name, input.brand, input.cropType, input.variety, input.category, input.description,
            JSON.stringify(input.packaging), JSON.stringify(input.regulatoryIds)],
        );
        const product = res.rows[0] as ProductRow;
        await insertCertifications(tx, actor.tenantId, { productId: product.id }, input.certifications);
        await writeAudit(tx, {
          tenantId: actor.tenantId, actorId: actor.userId, action: 'product.created', entityType: 'product', entityId: product.id, ip: actor.ip,
        });
        return { ...toDto(product), certifications: input.certifications };
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw conflict('PRODUCT_EXISTS', 'This product already exists');
      throw err;
    }
  }

  async function list(actor: Actor, q: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withActor(actor, async (tx) =>
      (await tx.query<ProductRow>(
        `SELECT * FROM products WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1, $2::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  async function get(actor: Actor, id: string) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query<ProductRow>('SELECT * FROM products WHERE id = $1', [id]);
      if (!res.rows[0]) throw notFound('Product not found');
      const certs = await tx.query('SELECT type, issuer, number, valid_from AS "validFrom", valid_to AS "validTo" FROM certifications WHERE product_id = $1', [id]);
      return { ...toDto(res.rows[0]), certifications: certs.rows };
    });
  }

  async function update(actor: TenantActor, id: string, patch: { description?: string | undefined; packaging?: Record<string, unknown> | undefined; regulatoryIds?: Record<string, string> | undefined }) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query<ProductRow>(
        `UPDATE products SET description = COALESCE($2, description), packaging = COALESCE($3, packaging),
           regulatory_ids = COALESCE($4, regulatory_ids), updated_at = now()
         WHERE id = $1 AND tenant_id = $5 RETURNING *`,
        [id, patch.description ?? null, patch.packaging ? JSON.stringify(patch.packaging) : null,
          patch.regulatoryIds ? JSON.stringify(patch.regulatoryIds) : null, actor.tenantId],
      );
      if (!res.rows[0]) throw notFound('Product not found');
      await writeAudit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'product.updated', entityType: 'product', entityId: id, ip: actor.ip });
      return toDto(res.rows[0]);
    });
  }

  return { create, list, get, update };
}

export type ProductService = ReturnType<typeof createProductService>;
