import postgres from 'postgres';

export const SQL = Symbol('SQL');
export type Sql = ReturnType<typeof createSql>;

export function createSql(url: string) {
  return postgres(url, { transform: postgres.camel });
}
