import type { OtpProvider } from './otp-provider';

// Fournisseur de developpement : le code est simplement ecrit dans la console du
// serveur. Regle 7 : aucune donnee sensible en clair dans les logs, donc le
// numero est masque (on ne montre que l'indicatif et les deux derniers chiffres).
export class ConsoleOtpProvider implements OtpProvider {
  public readonly name = 'console';

  public async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[otp:console] code ${code} pour ${maskPhone(phone)} (valable 5 minutes)`);
  }
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) {
    return '****';
  }
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}
