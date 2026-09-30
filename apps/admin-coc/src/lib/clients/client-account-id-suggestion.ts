export const CLIENT_ACCOUNT_ID_MAX_LENGTH = 80;
export const CLIENT_ACCOUNT_ID_MIN_LENGTH = 2;
export const CLIENT_ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export type ClientAccountIdSuggestion = {
  value: string;
  valid: boolean;
  message: string | null;
};

export type ClientAccountIdDraft = {
  value: string;
  manuallyEdited: boolean;
};

export function validateClientAccountId(value: string): ClientAccountIdSuggestion {
  if (value.length < CLIENT_ACCOUNT_ID_MIN_LENGTH) {
    return {
      value,
      valid: false,
      message: "Enter an account ID with at least 2 characters.",
    };
  }
  if (value.length > CLIENT_ACCOUNT_ID_MAX_LENGTH) {
    return {
      value,
      valid: false,
      message: `Enter an account ID with at most ${CLIENT_ACCOUNT_ID_MAX_LENGTH} characters.`,
    };
  }
  if (!CLIENT_ACCOUNT_ID_PATTERN.test(value)) {
    return {
      value,
      valid: false,
      message:
        "Use lowercase letters, numbers, and underscores, beginning with a letter.",
    };
  }
  return { value, valid: true, message: null };
}

export function suggestClientAccountId(displayName: string): ClientAccountIdSuggestion {
  const value = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CLIENT_ACCOUNT_ID_MAX_LENGTH)
    .replace(/_+$/g, "");

  if (!value) {
    return {
      value: "",
      valid: false,
      message: "Enter an account ID manually; this name does not contain supported letters.",
    };
  }
  return validateClientAccountId(value);
}

export function accountIdAfterDisplayNameChange(
  draft: ClientAccountIdDraft,
  displayName: string
): ClientAccountIdDraft {
  return draft.manuallyEdited
    ? draft
    : { value: suggestClientAccountId(displayName).value, manuallyEdited: false };
}

export function manuallyEditedAccountId(value: string): ClientAccountIdDraft {
  return { value: value.toLowerCase(), manuallyEdited: true };
}

export function resetToSuggestedAccountId(displayName: string): ClientAccountIdDraft {
  return { value: suggestClientAccountId(displayName).value, manuallyEdited: false };
}
