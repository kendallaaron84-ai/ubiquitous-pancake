export interface FirebasePublicConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

const CONFIG_KEYS: ReadonlyArray<[keyof FirebasePublicConfig, string]> = [
  ["apiKey", "NEXT_PUBLIC_FIREBASE_API_KEY"],
  ["authDomain", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
  ["storageBucket", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "NEXT_PUBLIC_FIREBASE_APP_ID"],
];

export function validateFirebasePublicConfig(config: FirebasePublicConfig): asserts config is Required<FirebasePublicConfig> {
  const missing = CONFIG_KEYS.filter(([key]) => !config[key]?.trim()).map(([, environmentKey]) => environmentKey);
  if (missing.length) throw new Error(`Firebase client configuration is incomplete. Missing: ${missing.join(", ")}`);
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(config.apiKey!.trim())) throw new Error("Firebase client configuration contains an invalid NEXT_PUBLIC_FIREBASE_API_KEY.");
}
