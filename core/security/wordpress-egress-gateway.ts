import "server-only";

import { GoogleAuth } from "google-auth-library";

import {
  WordPressConnectionDiagnosticError,
  type VerifiedWordPressConnection,
  type WordPressConnectionDiagnosticCode,
} from "@/core/security/wordpress-connection";

const DEFAULT_PRODUCTION_WORDPRESS_GATEWAY =
  "https://wordpress-egress-gateway-prod-aoosgrwosq-uc.a.run.app";

interface WordPressGatewayResponse {
  success?: boolean;
  code?: string;
  error?: string;
  targetWpOrigin?: string;
  wpUsername?: string;
  secretCredentialRef?: string;
}

export interface WordPressGatewayConnectionInput {
  studioKey: string;
  websiteConnectionId: string;
  targetWpOrigin: unknown;
  wpUsername: unknown;
  wpAppPassword: unknown;
}

let gatewayAuthClient: GoogleAuth | null = null;

function getGatewayAuthClient(): GoogleAuth {
  if (gatewayAuthClient) return gatewayAuthClient;
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Cloud Run gateway authentication is not configured.");
  }
  gatewayAuthClient = new GoogleAuth({
    projectId,
    credentials: { client_email: clientEmail, private_key: privateKey },
  });
  return gatewayAuthClient;
}

export function resolveWordPressGatewayUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.WORDPRESS_EGRESS_GATEWAY_URL?.trim() ||
    (environment.NODE_ENV === "production" ? DEFAULT_PRODUCTION_WORDPRESS_GATEWAY : "");
  if (!configured) return "";
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("WORDPRESS_EGRESS_GATEWAY_URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("WORDPRESS_EGRESS_GATEWAY_URL must be a public HTTPS service URL.");
  }
  return parsed.origin;
}

export async function verifyAndProvisionThroughGateway(
  gatewayUrl: string,
  input: WordPressGatewayConnectionInput,
): Promise<VerifiedWordPressConnection> {
  let gatewayResponse: { status: number; data: WordPressGatewayResponse };
  try {
    const authenticatedClient = await getGatewayAuthClient().getIdTokenClient(gatewayUrl);
    const response = await authenticatedClient.request<WordPressGatewayResponse>({
      url: `${gatewayUrl}/verify-wordpress`,
      method: "POST",
      data: input,
      timeout: 20_000,
      validateStatus: () => true,
    });
    gatewayResponse = { status: response.status, data: response.data || {} };
  } catch (error: unknown) {
    console.error("[WordPress Connection] Egress gateway request failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    throw new WordPressConnectionDiagnosticError(
      "NETWORK_TIMEOUT_TLS",
      "KOBA-I could not reach the secure WordPress connection service. Please retry.",
    );
  }

  const payload = gatewayResponse.data;
  if (gatewayResponse.status < 200 || gatewayResponse.status >= 300) {
    const gatewayCode = clean(payload.code);
    const publicMessage = clean(payload.error) || "KOBA-I could not complete the secure WordPress connection.";
    const diagnosticCodes = new Set<WordPressConnectionDiagnosticCode>([
      "INVALID_CREDENTIALS",
      "INSUFFICIENT_PERMISSIONS",
      "FIREWALL_CHALLENGE",
      "NETWORK_TIMEOUT_TLS",
      "REST_API_DISABLED",
      "VAULT_PROVISION_FAIL",
    ]);
    if (diagnosticCodes.has(gatewayCode as WordPressConnectionDiagnosticCode)) {
      throw new WordPressConnectionDiagnosticError(
        gatewayCode as WordPressConnectionDiagnosticCode,
        publicMessage,
        { httpStatus: gatewayResponse.status },
      );
    }
    if (gatewayResponse.status === 401 || gatewayResponse.status === 403) {
      throw new WordPressConnectionDiagnosticError(
        "VAULT_PROVISION_FAIL",
        "KOBA-I could not authorize the secure WordPress connection service. Please retry.",
      );
    }
    throw new Error(publicMessage);
  }

  const targetWpOrigin = clean(payload.targetWpOrigin);
  const wpUsername = clean(payload.wpUsername);
  const secretCredentialRef = clean(payload.secretCredentialRef);
  if (payload.success !== true || !targetWpOrigin || !wpUsername ||
      !/^projects\/[0-9]+\/secrets\/WP_CREDS_[A-Za-z0-9_-]+\/versions\/latest$/.test(secretCredentialRef)) {
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your site was verified, but secure setup returned an incomplete result. Please retry.",
    );
  }
  return { studioKey: clean(input.studioKey), targetWpOrigin, wpUsername, secretCredentialRef };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
