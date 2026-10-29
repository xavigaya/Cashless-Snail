/**
 * Crea el primer administrador de plataforma en un desplegament nou.
 * Només actua si encara no n'hi ha cap; si ja n'hi ha, no fa res.
 * Fa servir BOOTSTRAP_ADMIN_EMAIL i BOOTSTRAP_ADMIN_PASSWORD.
 * Ús: node dist/db/bootstrap.js (s'executa automàticament en cada desplegament)
 */
import { eq, sql } from 'drizzle-orm';
import { loadEnvFile } from '../config';
import { hashSecret } from '../common/crypto';
import { createDb, createSql } from './db';
import { adminUsers, roleAssignments } from './schema';

async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const client = createSql(url, { max: 1 });
  const db = createDb(client);
  try {
    const [existing] = await db.select({ id: roleAssignments.id }).from(roleAssignments).where(eq(roleAssignments.role, 'platform_admin')).limit(1);
    if (existing) {
      console.log('Ja hi ha un administrador de plataforma: no cal crear-ne cap.');
      return;
    }
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) {
      console.log('No hi ha cap administrador de plataforma. Defineix BOOTSTRAP_ADMIN_EMAIL i BOOTSTRAP_ADMIN_PASSWORD per crear-lo.');
      return;
    }
    if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD ha de tenir almenys 12 caràcters');

    // Si el correu ja és d'un usuari, se li dona el rol (sense canviar-li la contrasenya).
    const [found] = await db.select().from(adminUsers).where(eq(sql`lower(${adminUsers.email})`, email.toLowerCase())).limit(1);
    const user =
      found ?? (await db.insert(adminUsers).values({ email, name: 'Administrador de plataforma', passwordHash: await hashSecret(password) }).returning())[0]!;
    await db.insert(roleAssignments).values({ userId: user.id, role: 'platform_admin' });
    console.log(`Administrador de plataforma ${found ? 'assignat' : 'creat'}: ${email}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
