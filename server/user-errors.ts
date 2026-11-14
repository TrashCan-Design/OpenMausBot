const USER_ERROR: Record<string, string> = {
  "serverError.secret.missing": "this credential request was not found",
  "serverError.secret.settingsCard": "Open Settings to enter this credential",
  "serverError.secret.savingFromPhone": "this secret is currently being saved from a phone",
  "serverError.secret.declined": "this credential request was dismissed",
  "serverError.secret.replaced": "this credential request was superseded by a newer one",
  "serverError.secret.taskStopped": "this credential request's task has stopped",
  "serverError.secret.alreadySaved": "this credential was already saved",
  "serverError.secret.valueSize": "The secret can be at most {bytes} bytes.",
  "serverError.secret.notKeptSafely": "The secret could not be kept safely. Try again.",
  "serverError.secret.unavailableLower": "this credential request is no longer available",
  "serverError.secret.mailboxAlreadyConnected": "this mailbox was already connected",
  "serverError.secret.emailAndPassword": "Enter your email address and its password.",
  "serverError.secret.emailUnavailable": "Email can't be connected here.",
  "serverError.secret.localService": "A local service cannot enter a secret. Enter it in OpenBot.",
  "serverError.secret.cloudOwnerOnly": "Only the owner of this Cloud can enter this secret.",
  "serverError.secret.conversationOwnerOnly": "Only the person this conversation belongs to can enter this secret.",
  "serverError.secret.credentialSavingFromPhone": "this credential is currently being saved from a phone",
  "serverError.secret.credentialDismissed": "this credential request was dismissed",
  "serverError.secret.credentialSuperseded": "this credential request was superseded by a newer one",
  "serverError.secret.notSavedYet": "{label} was not saved yet",
  "serverError.secret.notReadyToResume": "this credential request is not ready to resume",
  "serverError.secret.noLongerConfigured": "{label} is no longer configured",
};

export type UserErrorKey = string;

export function userError(key: string, params?: Record<string, unknown>): { error: string; errorKey: string; errorParams?: Record<string, unknown> } {
  let text = USER_ERROR[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return { error: text, errorKey: key, ...(params ? { errorParams: params } : {}) };
}
