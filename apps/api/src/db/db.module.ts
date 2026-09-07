import { Global, Module } from '@nestjs/common';
import { SQL, createSql } from './db.provider.js';

@Global()
@Module({
  providers: [{ provide: SQL, useFactory: () => createSql(process.env.DATABASE_URL!) }],
  exports: [SQL],
})
export class DbModule {}
