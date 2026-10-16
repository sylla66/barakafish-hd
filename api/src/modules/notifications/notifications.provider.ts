import type { NotificationProvider } from './notifications.types';

export class ConsoleNotificationProvider implements NotificationProvider {
  async sendSms(to: string, text: string): Promise<void> {
    console.log('[sms]', { to, text });
  }

  async sendWhatsapp(to: string, text: string): Promise<void> {
    console.log('[whatsapp]', { to, text });
  }

  async sendPush(toUserId: string, text: string, payload?: Record<string, unknown>): Promise<void> {
    console.log('[push]', { toUserId, text, payload });
  }
}
