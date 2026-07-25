import { NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’\-]{1,119}$/u;

type PluginPlan = "ereader" | "audiobook_player" | "bundle";

type PluginCheckoutBody = {
  authorName?: unknown;
  authorEmail?: unknown;
  plan?: unknown;
};

type PlanDefinition = {
  label: string;
  envName: string;
  pluginType: "ereader_plugin" | "audiobook_plugin" | "koba_i_plugin_suite";
  hasAudiobookPlayer: boolean;
  hasEreader: boolean;
};

const PLANS: Readonly<Record<PluginPlan, PlanDefinition>> = Object.freeze({
  ereader: {
    label: "KOBA-I E-Reader",
    envName: "STRIPE_PRICE_PLUGIN_EREADER",
    pluginType: "ereader_plugin",
    hasAudiobookPlayer: false,
    hasEreader: true,
  },
  audiobook_player: {
    label: "KOBA-I Audiobook Player",
    envName: "STRIPE_PRICE_PLUGIN_AUDIOBOOK",
    pluginType: "audiobook_plugin",
    hasAudiobookPlayer: true,
    hasEreader: false,
  },
  bundle: {
    label: "KOBA-I Author Publishing Bundle",
    envName: "STRIPE_PRICE_PLUGIN_BUNDLE",
    pluginType: "koba_i_plugin_suite",
    hasAudiobookPlayer: true,
    hasEreader: true,
  },
});

function isPluginPlan(value: unknown): value is PluginPlan {
  return value === "ereader" || value === "audiobook_player" || value === "bundle";
}

function normalizeName(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveApplicationOrigin(request: Request): string {
  const candidate = process.env.KOBA_DASHBOARD_URL?.trim() || new URL(request.url).origin;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("KOBA_DASHBOARD_URL must use HTTP or HTTPS.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production plugin checkout requires HTTPS.");
  }
  return url.origin;
}

function requireStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return new Stripe(secretKey);
}

function resolvePriceId(plan: PluginPlan): string {
  const value = process.env[PLANS[plan].envName]?.trim();
  if (!value) throw new Error(`${PLANS[plan].envName} is not configured.`);
  return value;
}

export async function GET() {
  try {
    const stripe = requireStripe();
    const plans = await Promise.all(
      (Object.keys(PLANS) as PluginPlan[]).map(async (plan) => {
        const definition = PLANS[plan];
        const price = await stripe.prices.retrieve(resolvePriceId(plan));
        if (!price.active || price.unit_amount === null) {
          throw new Error(`${definition.label} does not have an active fixed Stripe price.`);
        }
        return {
          id: plan,
          label: definition.label,
          unitAmount: price.unit_amount,
          currency: price.currency,
          recurringInterval: price.recurring?.interval || null,
        };
      }),
    );
    return NextResponse.json({ success: true, plans }, { status: 200 });
  } catch (error) {
    console.error("Unable to load plugin storefront pricing.", error);
    return NextResponse.json(
      { success: false, error: "Plugin pricing is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as PluginCheckoutBody | null;
    const authorName = normalizeName(body?.authorName);
    const authorEmail = normalizeEmail(body?.authorEmail);
    const plan = body?.plan;

    if (!NAME_PATTERN.test(authorName)) {
      return NextResponse.json(
        { success: false, error: "Enter the author's full name." },
        { status: 400 },
      );
    }
    if (!EMAIL_PATTERN.test(authorEmail)) {
      return NextResponse.json(
        { success: false, error: "Enter a valid author email address." },
        { status: 400 },
      );
    }
    if (!isPluginPlan(plan)) {
      return NextResponse.json(
        { success: false, error: "Select a valid KOBA-I author product." },
        { status: 400 },
      );
    }

    const stripe = requireStripe();
    const priceId = resolvePriceId(plan);
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.unit_amount === null) {
      return NextResponse.json(
        { success: false, error: "The selected product is not available for checkout." },
        { status: 409 },
      );
    }

    const definition = PLANS[plan];
    const applicationOrigin = resolveApplicationOrigin(request);
    const metadata: Record<string, string> = {
      checkoutType: "plugin_purchase",
      productType: "author_plugin",
      pluginType: definition.pluginType,
      plan,
      authorName,
      authorEmail,
      hasAudiobookPlayer: String(definition.hasAudiobookPlayer),
      hasEreader: String(definition.hasEreader),
    };
    const mode: Stripe.Checkout.SessionCreateParams.Mode = price.type === "recurring"
      ? "subscription"
      : "payment";

    const session = await stripe.checkout.sessions.create({
      mode,
      customer_email: authorEmail,
      client_reference_id: authorEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      ...(mode === "subscription" ? { subscription_data: { metadata } } : {}),
      success_url: `${applicationOrigin}/signup?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${applicationOrigin}/signup?checkout=cancelled`,
    });

    if (!session.url) throw new Error("Stripe did not return a hosted checkout URL.");
    return NextResponse.json({ success: true, checkoutUrl: session.url }, { status: 200 });
  } catch (error) {
    console.error("Unable to create the author plugin checkout session.", error);
    return NextResponse.json(
      { success: false, error: "Unable to start secure checkout." },
      { status: 500 },
    );
  }
}
