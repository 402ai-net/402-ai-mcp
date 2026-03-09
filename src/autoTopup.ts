import "websocket-polyfill";
import { NWCClient } from "@getalby/sdk/nwc";
import { AlbomHttpClient } from "./httpClient.js";
import type { AlbomToolResult, AutoTopupInfo, NormalizedHttpResponse } from "./types.js";
import { toErrorMessage } from "./utils.js";

export interface AutoTopupConfig {
  nwcUri?: string;
  thresholdSats: number;
  topupUsd: number;
  maxDailyUsd: number;
}

export interface InvoicePaymentResult {
  preimage: string;
}

export interface InvoicePayer {
  payInvoice(invoice: string): Promise<InvoicePaymentResult>;
}

export interface InvoicePayerFactory {
  create(nwcUri: string): InvoicePayer;
}

interface SpendEvent {
  amountUsd: number;
  createdAtMs: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractBalanceSats(result: AlbomToolResult): number | undefined {
  if (result.ok) {
    const data = asRecord(result.data);
    return asNumber(data?.balance_sats);
  }

  return asNumber(result.error.available_sats) ?? asNumber(result.error.balance_sats);
}

function extractInvoice(response: NormalizedHttpResponse): { invoice: string; paymentHash?: string } {
  const data = asRecord(response.data);
  const invoice = asString(data?.invoice);
  if (!invoice) {
    throw new Error("Topup invoice response did not include an invoice");
  }

  return {
    invoice,
    paymentHash: asString(data?.payment_hash)
  };
}

function extractClaim(response: NormalizedHttpResponse): { token?: string; balanceSats?: number } {
  const data = asRecord(response.data);
  return {
    token: asString(data?.token),
    balanceSats: asNumber(data?.balance_sats)
  };
}

class NwcInvoicePayer implements InvoicePayer {
  private readonly client: NWCClient;

  public constructor(nwcUri: string) {
    this.client = new NWCClient({
      nostrWalletConnectUrl: nwcUri
    });
  }

  public async payInvoice(invoice: string): Promise<InvoicePaymentResult> {
    const result = await this.client.payInvoice({ invoice });
    return {
      preimage: result.preimage
    };
  }
}

export class DefaultInvoicePayerFactory implements InvoicePayerFactory {
  public create(nwcUri: string): InvoicePayer {
    return new NwcInvoicePayer(nwcUri);
  }
}

export class NwcAutoTopupManager {
  private readonly spendEvents: SpendEvent[] = [];
  private inflight: Promise<AutoTopupInfo> | undefined;

  public constructor(
    private readonly config: AutoTopupConfig,
    private readonly httpClient: AlbomHttpClient,
    private readonly payerFactory: InvoicePayerFactory = new DefaultInvoicePayerFactory()
  ) {}

  public isEnabled(): boolean {
    return Boolean(this.config.nwcUri);
  }

  public async maybeTopup(result: AlbomToolResult): Promise<AutoTopupInfo | undefined> {
    if (!this.isEnabled()) {
      return undefined;
    }

    const balanceSats = extractBalanceSats(result);
    if (balanceSats === undefined || balanceSats >= this.config.thresholdSats) {
      return undefined;
    }

    if (!this.httpClient.getBearerToken()) {
      return {
        attempted: false,
        triggered: false,
        status: "skipped",
        reason: "missing_bearer_token",
        threshold_sats: this.config.thresholdSats,
        topup_usd: this.config.topupUsd,
        balance_sats: balanceSats
      };
    }

    if (this.dailySpendUsd() + this.config.topupUsd > this.config.maxDailyUsd) {
      return {
        attempted: false,
        triggered: false,
        status: "skipped",
        reason: "daily_limit_reached",
        threshold_sats: this.config.thresholdSats,
        topup_usd: this.config.topupUsd,
        balance_sats: balanceSats
      };
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.performTopup(balanceSats).finally(() => {
      this.inflight = undefined;
    });

    return this.inflight;
  }

  private async performTopup(balanceSats: number): Promise<AutoTopupInfo> {
    try {
      const invoiceResponse = await this.httpClient.postJson("/api/v1/topup", {
        amount_usd: this.config.topupUsd
      });

      if (invoiceResponse.status !== 402) {
        throw new Error(`Topup invoice request returned status ${invoiceResponse.status}`);
      }

      const { invoice } = extractInvoice(invoiceResponse);
      const payer = this.payerFactory.create(this.config.nwcUri!);
      const payment = await payer.payInvoice(invoice);

      const claimResponse = await this.httpClient.postJson("/api/v1/topup/claim", {
        preimage: payment.preimage
      });

      if (claimResponse.status !== 200) {
        throw new Error(`Topup claim returned status ${claimResponse.status}`);
      }

      const claim = extractClaim(claimResponse);
      if (claim.token) {
        this.httpClient.setBearerToken(claim.token);
      }

      this.recordSpend(this.config.topupUsd);

      return {
        attempted: true,
        triggered: true,
        status: "succeeded",
        threshold_sats: this.config.thresholdSats,
        topup_usd: this.config.topupUsd,
        previous_balance_sats: balanceSats,
        balance_sats: claim.balanceSats,
        new_balance_sats: claim.balanceSats
      };
    } catch (error) {
      return {
        attempted: true,
        triggered: true,
        status: "failed",
        threshold_sats: this.config.thresholdSats,
        topup_usd: this.config.topupUsd,
        previous_balance_sats: balanceSats,
        balance_sats: balanceSats,
        error: toErrorMessage(error)
      };
    }
  }

  private recordSpend(amountUsd: number): void {
    this.pruneSpendEvents(Date.now());
    this.spendEvents.push({
      amountUsd,
      createdAtMs: Date.now()
    });
  }

  private dailySpendUsd(): number {
    const now = Date.now();
    this.pruneSpendEvents(now);
    return roundUsd(this.spendEvents.reduce((total, event) => total + event.amountUsd, 0));
  }

  private pruneSpendEvents(now: number): void {
    const windowStart = now - 24 * 60 * 60 * 1000;
    while (this.spendEvents[0] && this.spendEvents[0].createdAtMs < windowStart) {
      this.spendEvents.shift();
    }
  }
}
