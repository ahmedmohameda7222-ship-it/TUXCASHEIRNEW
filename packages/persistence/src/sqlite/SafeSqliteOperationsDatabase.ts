import type { CustomerContact } from '@tux/domain';
import type { OperationsTransaction } from '../contracts';
import { SqliteOperationsDatabase as BaseSqliteOperationsDatabase } from './SqliteOperationsDatabase';

function withImmutableCustomerContactIdentity(
  transaction: OperationsTransaction,
): OperationsTransaction {
  return {
    ...transaction,
    customerContacts: {
      ...transaction.customerContacts,
      async put(contact: CustomerContact): Promise<void> {
        const existing = await transaction.customerContacts.getByNormalizedPhone(
          contact.shopId,
          contact.normalizedPhone,
        );

        if (existing !== null && existing.id !== contact.id) {
          throw new Error(
            `Customer contact identity mismatch for normalized phone ${contact.normalizedPhone}.`,
          );
        }

        await transaction.customerContacts.put(contact);
      },
    },
  };
}

export class SqliteOperationsDatabase extends BaseSqliteOperationsDatabase {
  override async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    return super.transaction((transaction) =>
      work(withImmutableCustomerContactIdentity(transaction)),
    );
  }
}
