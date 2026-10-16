import { env } from '../../config/env';
import { AggregatorPaymentProvider } from './aggregator-payment-provider';
import { MockPaymentProvider } from './mock-payment-provider';
import type { PaymentProvider } from './payment-provider';

let currentProvider: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  if (!currentProvider) {
    currentProvider = createPaymentProvider();
  }
  return currentProvider;
}

function createPaymentProvider(): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'aggregator':
      return new AggregatorPaymentProvider();
    case 'mock':
    default:
      return new MockPaymentProvider();
  }
}

export type {
  InitiatePaymentResult,
  PaymentBuyer,
  PaymentEvent,
  PaymentEventStatus,
  PaymentOrder,
  PaymentProvider,
  PayoutSeller,
} from './payment-provider';
