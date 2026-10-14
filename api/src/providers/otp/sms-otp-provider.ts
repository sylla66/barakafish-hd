import { AppError } from '../../lib/AppError';
import type { OtpProvider } from './otp-provider';

// Squelette du fournisseur SMS reel, a completer a l'etape des notifications.
// TODO: brancher l'agregateur (PayDunya / PayTech / CinetPay...), gerer les
// erreurs et les reessais, et journaliser l'envoi dans la table `notifications`.
// En attendant, il echoue explicitement pour ne pas donner l'impression que
// l'envoi fonctionne.
export class SmsOtpProvider implements OtpProvider {
  public readonly name = 'sms';

  public async sendOtp(): Promise<void> {
    throw new AppError(501, 'Fournisseur SMS non configure.', 'fournisseur_indisponible');
  }
}
