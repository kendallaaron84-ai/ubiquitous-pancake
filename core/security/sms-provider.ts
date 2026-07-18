import twilio from "twilio";

import { createMockOtp, hmacHex } from "./crypto";
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
