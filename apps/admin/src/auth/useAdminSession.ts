import { useContext } from 'react';

import { AdminSessionContext } from './AdminSessionProvider';

export function useAdminSession() {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession must be used within AdminSessionProvider');
  return value;
}
