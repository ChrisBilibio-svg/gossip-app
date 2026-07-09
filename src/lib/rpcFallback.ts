export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function isMissingRpcError(error: unknown): error is RpcErrorLike {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as RpcErrorLike;
  const text = `${maybe.code ?? ''} ${maybe.message ?? ''} ${maybe.details ?? ''} ${maybe.hint ?? ''}`.toLowerCase();
  return (
    text.includes('pgrst202') ||
    text.includes('42883') ||
    text.includes('could not find the function') ||
    text.includes('function') && text.includes('does not exist') ||
    text.includes('cache lookup failed for function')
  );
}

export function rpcFallbackMessage(functionName: string): string {
  return `Backend update still applying: ${functionName} RPC is unavailable, using the legacy path for now.`;
}
