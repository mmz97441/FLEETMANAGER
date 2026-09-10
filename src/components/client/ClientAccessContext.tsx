import { createContext, useContext } from 'react';
import { runClientMutation } from '../../utils/clientMutation';

export interface ClientAccess {
  readOnly: boolean;
  impersonating: boolean;
  contextLabel?: string;
  runMutation: <T>(action: string, operation: () => Promise<T>) => Promise<T>;
}

export const ClientAccessContext = createContext<ClientAccess>({
  readOnly: false,
  impersonating: false,
  runMutation: (action, operation) => runClientMutation({ readOnly: false }, action, operation),
});
export const useClientAccess = () => useContext(ClientAccessContext);
