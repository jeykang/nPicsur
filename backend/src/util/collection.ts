import { FindOptionsSelect, ObjectLiteral, Repository } from 'typeorm';

// This is a function that selects all available columns in a database table
// It is used to fetch hidden columns from the database
export function GetCols<T extends ObjectLiteral>(
  repository: Repository<T>,
): FindOptionsSelect<T> {
  return Object.fromEntries(
    repository.metadata.columns.map((col) => [col.propertyName, true]),
  ) as FindOptionsSelect<T>;
}

// A where condition for what a user owns. Without a user it is left out, to
// find what anyone owns, as TypeORM throws on undefined in a where condition.
export function OwnedBy(userid: string | undefined): { user_id?: string } {
  return userid === undefined ? {} : { user_id: userid };
}
