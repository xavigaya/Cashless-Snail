import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { loginSchema, type LoginResult, type Me } from '@cashless/shared';
import { verifySecret } from '../../common/crypto';
import { parseInput, unauthorized } from '../../common/errors';
import { signJwt } from '../../common/jwt';
import { adminUsers, roleAssignments } from '../../db/schema';
import type { AdminTokenPayload } from '../../auth/principals';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppDeps, type AppEnv } from '../context';

const ADMIN_SESSION_SECONDS = 12 * 3600;
// Hash vàlid però que no correspon a cap contrasenya: es verifica igualment per no revelar,
// pel temps de resposta, si un correu existeix.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function authRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>();

  app.post('/auth/login', async (c) => {
    const input = parseInput(loginSchema, await readJson(c));
    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(sql`lower(${adminUsers.email})`, input.email.toLowerCase()))
      .limit(1);
    const ok = await verifySecret(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.active || !ok) throw unauthorized('Correu o contrasenya incorrectes');

    const roles = await db
      .select({ role: roleAssignments.role, organizationId: roleAssignments.organizationId, eventId: roleAssignments.eventId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, user.id));
    const payload: AdminTokenPayload = { sub: user.id, kind: 'admin' };
    const result: LoginResult = {
      token: signJwt({ ...payload }, config.jwtSecret, ADMIN_SESSION_SECONDS),
      user: { id: user.id, email: user.email, name: user.name, roles },
    };
    return c.json(result, 200);
  });

  app.get('/auth/me', requireAdmin, (c) => c.json(c.get('admin') satisfies Me));

  return app;
}
