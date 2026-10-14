import { env } from '../../config/env';
import { ConsoleOtpProvider } from './console-otp-provider';
import type { OtpProvider } from './otp-provider';
import { SmsOtpProvider } from './sms-otp-provider';

let currentProvider: OtpProvider | undefined;

// Fabrique : renvoie le fournisseur d'OTP selon OTP_PROVIDER. Instancie une
// seule fois (memoisation) pour reutiliser les connexions cote fournisseur.
export function getOtpProvider(): OtpProvider {
  if (!currentProvider) {
    currentProvider = createOtpProvider();
  }
  return currentProvider;
}

function createOtpProvider(): OtpProvider {
  switch (env.OTP_PROVIDER) {
    case 'sms':
    case 'whatsapp':
      // La livraison WhatsApp utilisera un modele dedie (etape Notifications) ;
      // en attendant on reutilise le squelette SMS.
      return new SmsOtpProvider();
    case 'console':
    default:
      return new ConsoleOtpProvider();
  }
}

export type { OtpProvider };
