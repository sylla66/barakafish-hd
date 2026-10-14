// Contrat d'envoi des codes a usage unique. Les implementations sont
// interchangeables via la variable d'environnement OTP_PROVIDER, ce qui permettra
// de passer de la console (dev) a un vrai fournisseur SMS/WhatsApp sans toucher
// au reste du code.
export interface OtpProvider {
  readonly name: string;
  sendOtp(phone: string, code: string): Promise<void>;
}
