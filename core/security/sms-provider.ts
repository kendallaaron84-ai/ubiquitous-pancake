import twilio from "twilio";

import {
  createMockOtp,
  hmacHex,
  safeEqualHex,
} from "./crypto";
import type { SecurityEnvironment } from "./environment";

export interface SmsChallengeDispatchInput {
  environment: SecurityEnvironment;
  verificationSessionId: string;
  phoneE164: string;
}

export interface SmsChallengeDispatchResult {
  providerVerificationSid: string | null;
  mockOtpDigest: string | null;
  /**
   * Local-process diagnostic only. Routes must never serialize this value to
   * a browser response or persist it in Firestore.
   */
  developmentCode: string | null;
}

export interface SmsChallengeVerificationInput {
  environment: SecurityEnvironment;
  verificationSessionId: string;
  providerVerificationSid: string | null;
  mockOtpDigest: string | null;
  submittedCode: string;
}

export interface SmsChallengeVerificationResult {
  approved: boolean;
  terminal: boolean;
  providerStatus: string;
}

interface SmsProviderDependencies {
  createOtp: () => string;
  createTwilioClient: typeof twilio;
}

const defaultDependencies: SmsProviderDependencies = {
  createOtp: createMockOtp,
  createTwilioClient: twilio,
};

export async function dispatchSmsChallenge(
  input: SmsChallengeDispatchInput,
  dependencies: SmsProviderDependencies = defaultDependencies
): Promise<SmsChallengeDispatchResult> {
  const { environment, verificationSessionId, phoneE164 } = input;

  if (environment.smsProvider === "mock") {
    if (environment.appEnvironment === "production") {
      throw new Error("Mock SMS dispatch is forbidden in production.");
    }

    const otp = dependencies.createOtp();

    if (!/^\d{6}$/.test(otp)) {
      throw new Error("Mock OTP generator returned an invalid value.");
    }

    return {
      providerVerificationSid: null,
      mockOtpDigest: hmacHex(
        environment.hmacSecret,
        `mock-otp:v1:${verificationSessionId}:${otp}`
      ),
      developmentCode: otp,
    };
  }

  const accountSid = environment.twilioAccountSid;
  const authToken = environment.twilioAuthToken;
  const serviceSid = environment.twilioVerifyServiceSid;

  if (!accountSid || !authToken || !serviceSid) {
    throw new Error("Twilio Verify configuration is incomplete.");
  }

  const client = dependencies.createTwilioClient(
    accountSid,
    authToken
  );
  const verification = await client.verify.v2
    .services(serviceSid)
    .verifications.create({
      to: phoneE164,
      channel: "sms",
      riskCheck: "enable",
    });

  if (!verification.sid || verification.status !== "pending") {
    throw new Error("Twilio Verify did not accept the challenge.");
  }

  return {
    providerVerificationSid: verification.sid,
    mockOtpDigest: null,
    developmentCode: null,
  };
}

export async function verifySmsChallenge(
  input: SmsChallengeVerificationInput,
  dependencies: SmsProviderDependencies = defaultDependencies
): Promise<SmsChallengeVerificationResult> {
  const {
    environment,
    verificationSessionId,
    providerVerificationSid,
    mockOtpDigest,
    submittedCode,
  } = input;

  if (!/^\d{6}$/.test(submittedCode)) {
    return {
      approved: false,
      terminal: false,
      providerStatus: "invalid_code_format",
    };
  }

  if (environment.smsProvider === "mock") {
    if (environment.appEnvironment === "production") {
      throw new Error("Mock SMS verification is forbidden in production.");
    }

    if (!mockOtpDigest) {
      throw new Error("Mock verification digest is missing.");
    }

    const submittedDigest = hmacHex(
      environment.hmacSecret,
      `mock-otp:v1:${verificationSessionId}:${submittedCode}`
    );
    const approved = safeEqualHex(
      mockOtpDigest,
      submittedDigest
    );

    return {
      approved,
      terminal: false,
      providerStatus: approved ? "approved" : "pending",
    };
  }

  const accountSid = environment.twilioAccountSid;
  const authToken = environment.twilioAuthToken;
  const serviceSid = environment.twilioVerifyServiceSid;

  if (
    !accountSid ||
    !authToken ||
    !serviceSid ||
    !providerVerificationSid
  ) {
    throw new Error("Twilio Verify validation configuration is incomplete.");
  }

  const client = dependencies.createTwilioClient(
    accountSid,
    authToken
  );
  const verification = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({
      verificationSid: providerVerificationSid,
      code: submittedCode,
    });
  const status = verification.status || "unknown";

  return {
    approved: status === "approved" || verification.valid === true,
    terminal: [
      "max_attempts_reached",
      "canceled",
      "deleted",
      "expired",
      "failed",
    ].includes(status),
    providerStatus: status,
  };
}
