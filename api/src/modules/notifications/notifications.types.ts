export type NotificationChannel = "sms" | "whatsapp" | "push";

export interface NotificationProvider {
  sendSms(to: string, text: string): Promise<void>;
  sendWhatsapp(to: string, text: string): Promise<void>;
  sendPush(toUserId: string, text: string, payload?: Record<string, unknown>): Promise<void>;
}
