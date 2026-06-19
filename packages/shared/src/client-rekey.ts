export function buildClientRekeyConfirmationPhrase(
  sourceClientAccountId: string,
  targetClientAccountId: string
): string {
  return `REKEY CLIENT ${sourceClientAccountId.trim()} TO ${targetClientAccountId.trim()}`;
}

export function isClientRekeyConfirmationValid(
  sourceClientAccountId: string,
  targetClientAccountId: string,
  confirmation: string
): boolean {
  return (
    confirmation.trim() ===
    buildClientRekeyConfirmationPhrase(sourceClientAccountId, targetClientAccountId)
  );
}
