import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from './config';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule, DB, type Db } from './db/db';
import { TpvModule } from './tpv/tpv.module';

@Controller()
export class MetaController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Comprovació de salut per a monitoratge. */
  @Get('health')
  async health(): Promise<{ status: 'ok'; time: string }> {
    await this.db.execute(sql`SELECT 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Dades públiques que necessita el backoffice (p. ex. per generar el QR de vinculació). */
  @Get('meta')
  meta(): { publicApiUrl: string } {
    return { publicApiUrl: this.config.publicApiUrl };
  }
}

@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), DatabaseModule, AuthModule, AdminModule, TpvModule],
      controllers: [MetaController],
    };
  }
}
