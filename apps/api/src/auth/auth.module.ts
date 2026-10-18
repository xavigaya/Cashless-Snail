import { Body, Controller, Get, Global, HttpCode, Inject, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { eq, sql } from 'drizzle-orm';
import { loginSchema, type LoginInput, type LoginResult, type Me } from '@cashless/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { verifySecret } from '../common/crypto';
import { unauthorized, ZodPipe } from '../common/errors';
import { DB, type Db } from '../db/db';
import { adminUsers, roleAssignments } from '../db/schema';
import { AdminGuard, OperatorGuard, TerminalGuard, type AdminTokenPayload } from './guards';
import { type AdminPrincipal, CurrentAdmin } from './principals';

const ADMIN_SESSION = '12h';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const [user] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(sql`lower(${adminUsers.email})`, input.email.toLowerCase()))
      .limit(1);
    // Es verifica sempre una contrasenya per no revelar si el correu existeix pel temps de resposta.
    const ok = await verifySecret(input.password, user?.passwordHash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
    if (!user || !user.active || !ok) throw unauthorized('Correu o contrasenya incorrectes');

    const roles = await this.db
      .select({ role: roleAssignments.role, organizationId: roleAssignments.organizationId, eventId: roleAssignments.eventId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, user.id));
    const payload: AdminTokenPayload = { sub: user.id, kind: 'admin' };
    const token = await this.jwt.signAsync(payload, { expiresIn: ADMIN_SESSION });
    return { token, user: { id: user.id, email: user.email, name: user.name, roles } };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput): Promise<LoginResult> {
    return this.auth.login(body);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AdminPrincipal): Me {
    return admin;
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtSecret }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminGuard, TerminalGuard, OperatorGuard],
  exports: [AdminGuard, TerminalGuard, OperatorGuard],
})
export class AuthModule {}
