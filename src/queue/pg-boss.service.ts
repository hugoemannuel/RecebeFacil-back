import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

export const NOTIFICATION_QUEUE = 'whatsapp-notification';

@Injectable()
export class PgBossService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBoss;

  async onApplicationBootstrap() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DATABASE_URL not set — pg-boss não iniciou');
      return;
    }
    this.boss = new PgBoss(connectionString);
    this.boss.on('error', (err) => this.logger.error('pg-boss error:', err));
    await this.boss.start();
    this.logger.log('pg-boss iniciado');
  }

  async onApplicationShutdown() {
    if (this.boss) {
      await this.boss.stop();
      this.logger.log('pg-boss encerrado');
    }
  }

  async send(queue: string, data: Record<string, unknown>, options: Record<string, unknown> = {}): Promise<string | null> {
    return this.boss.send(queue, data, options);
  }

  get instance(): PgBoss {
    return this.boss;
  }
}
